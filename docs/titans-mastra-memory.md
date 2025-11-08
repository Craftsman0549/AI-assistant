# Titans視点でのAIメモリ階層設計

このドキュメントは、Titansのメモリ観点（短期=Attention、長期=Neural LTM、恒久プロファイル=Permanent）をMastraワークフローに落とし込むための設計指針をまとめたものである。分類基準、昇格・忘却ルール、そしてCodexにそのまま渡せるYAML雛形を提供し、AIアシスタントに記憶を与える機能を開発するための具体的な足場とする。

## 1. メモリ分類基準

| レイヤー | 役割 | 保存対象 | ライフサイクル | 技術対応 |
|-----------|------|----------|-----------------|-----------|
| STM (短期) | 今のターンを正しく処理するための作業記憶 | 直近のユーザー意図、タスクの中間状態、一時的な値（OTPや一時URLなど機微な内容はマスク） | スレッド内で数十分〜数時間保持後に自動破棄 | メッセージバッファ + MastraのWorking Memory |
| LTM (長期) | 将来の同種課題に再利用できる知識・事実 | 頻出の好み、反復される目標、確定回答、プロジェクト固有の語彙や手順の要約 | 条件付き昇格・減衰のもとで保持し、長期的に参照 | 埋め込み + ベクトルDB（再ランク併用） |
| PM (恒久) | 本人同意に基づく識別的・安定的なプロフィール | 文体・敬称・連絡手段・合意事項・課金/規約同意など、法令順守ログ | 長期保持。LTMへは要約や影響のみを伝播 | 暗号化済みSQL + 監査ログ |

## 2. 昇格・忘却ルール

- **再言及頻度**: 同一トピックの過去90日での出現回数が `>= 3` の場合はLTM昇格候補。
- **明示フラグ**: ユーザーの「覚えて」「保存して」「今後も適用して」などの発話はPM優先で保存。
- **新規性判定**: クエリ埋め込みと既存LTMの最良類似度が `0.62` 未満なら新規とみなす。
- **有用性**: 直近KセッションでのRAG採用回数・再ランク上位率・応答の自信度などをスコア化し、閾値 `>= 0.15` のとき昇格。
- **機微情報の扱い**: PIIや機微情報はPMにトークン化して格納し、LTM側には要約など非PII形でのみ伝播。
- **減衰スケジュール**: `last_used_at` に基づき、30/90/180/365日の閾値でスコア逓減→アーカイブ→削除を実施。

## 3. 改良ポイント

1. **有用性指標の導入**: 単純な頻度ではなく、実際に応答生成で使用された回数を昇格の根拠とする。
2. **PM→LTMの影響写像**: PMの生データは直接利用せず、文体や方針といった非PIIの派生情報のみをLTMへ反映。
3. **応答前ガードの強化**: 年代・矛盾・機微情報を除外するフィルタプロンプトを固定化し、不適切なメモリ利用を防ぐ。
4. **監査ログの一元化**: すべての保存・削除をAuditストアにイベントとして記録し、追跡可能性を確保。
5. **バッチ再学習フック**: 夜間にEmbedding再計算や再インデックス処理を行うCronタスクをMastraのWorkflowで実行。

## 4. MastraワークフローYAML雛形

以下は、Titans設計をMastra上で実装するためのYAMLテンプレートである。変数は `{{ }}` で外部から注入する想定。

```yaml
version: "1.0"

meta:
  project: "assistant-memory-tritier"
  owner: "nexuslab"
  description: "Titans由来の短期/長期/永続メモリをMastraで運用する"
  env:
    OPENAI_API_KEY: "{{ env.OPENAI_API_KEY }}"
    LLM_MODEL: "gpt-4.1"
    EMBEDDING_MODEL: "text-embedding-3-large"
    RERANKER_MODEL: "cross-encoder/ms-marco-MiniLM-L-6-v2"
    VECTOR_DB_URL: "{{ env.VECTOR_DB_URL }}"
    SQL_DSN: "{{ env.SQL_DSN }}"
    AUDIT_BUCKET: "s3://memory-audit-logs"

resources:
  models:
    llm:
      provider: "openai"
      model: "{{ LLM_MODEL }}"
      temperature: 0.2
    embed:
      provider: "openai"
      model: "{{ EMBEDDING_MODEL }}"
    reranker:
      provider: "hf"
      model: "{{ RERANKER_MODEL }}"

  stores:
    stm:
      kind: "kv"
      ttl_seconds: 7200
    ltm:
      kind: "vector"
      provider: "qdrant"
      url: "{{ VECTOR_DB_URL }}"
      collection: "ltm_memory"
      vector_size: 3072
      distance: "cosine"
    pm:
      kind: "sql"
      dsn: "{{ SQL_DSN }}"
      tables: ["user_profile", "consent_log"]
    audit:
      kind: "object"
      bucket: "{{ AUDIT_BUCKET }}"

policies:
  promotion:
    remention_min: 3
    novelty_threshold: 0.62
    explicit_save: true
    usefulness_min: 0.15
  decay:
    warm_days: 30
    cool_days: 90
    archive_days: 180
    delete_days: 365
  safety:
    pii_masking: true
    min_similarity_for_use: 0.78
    allow_none: true

schemas:
  stm_item:
    session_id: string
    role: enum[user,assistant,system]
    text: string
    timestamp: string
  ltm_item:
    id: string
    user_id: string
    text: string
    topic: string
    embedding: vector
    salience: number
    confidence: number
    last_used_at: string
    sensitivity: enum[none,low,pii_summary]
  pm_item:
    user_id: string
    key: string
    value_json: json
    pii_flag: boolean
    consent: boolean
    version: string
    updated_at: string

prompts:
  summarize_turn:
    role: "system"
    content: |
      直近の対話から「決定事項/依頼/事実/方針」を抽出し200字以内で要約。
      明示保存指示（例: 覚えて）を検出。PIIは含めずに書き換える。
      出力は JSON: {items:[{text, topic, explicit:boolean, pii:boolean}]}
  extract_profile:
    role: "system"
    content: |
      ユーザーの恒久設定（文体/敬称/連絡先/同意）を key/value JSON に整形。
      PIIはトークン化し、pm格納用の {key, value_json, pii_flag:true} を返す。
  retrieval_guard:
    role: "system"
    content: |
      候補メモと質問を突き合わせ、無関係・古い・矛盾・機微な項目を除外。
      不足なら "NONE" を返す。

workflows:

  ingest_message:
    trigger: "http:POST:/ingest"
    input: { user_id: string, session_id: string, text: string, timestamp: string }
    steps:
      - name: append_stm
        uses: "stores.stm"
        with:
          op: "append"
          key: "{{ session_id }}"
          value: { role: "user", text: "{{ text }}", timestamp: "{{ timestamp }}" }

      - name: summarize_if_needed
        run: |
          if token_count("{{ session_id }}") > 6000:
            chunk = stm_tail("{{ session_id }}", 30)
            summary = llm("prompts.summarize_turn", chunk)
            emit("summary", summary)

      - name: classify_candidates
        when: "has_event('summary')"
        run: |
          items = json_parse(event('summary')).items
          emit("promotion_candidates", items)

      - name: explicit_pm_update
        run: |
          if has_explicit_memory_command("{{ text }}"):
            profile = llm("prompts.extract_profile", "{{ text }}")
            emit("pm_updates", profile)

      - name: audit
        uses: "stores.audit"
        with:
          op: "put"
          key: "ingest/{{ session_id }}/{{ timestamp }}"
          value_ref: "event://ingest"

  summarize_and_promote:
    trigger: "event:promotion_candidates"
    steps:
      - name: embed_item
        uses: "models.embed"
        with: { text: "{{ item.text }}" }
        out: "e"

      - name: search_near
        uses: "stores.ltm"
        with: { op: "search", vector: "{{ e }}", limit: 5, filter: { user_id: "{{ user_id }}" } }
        out: "near"

      - name: decide
        run: |
          freq = count_mentions("{{ item.topic }}", days=90)
          nov  = novelty_score("{{ item.text }}", near)
          use  = recent_usefulness("{{ item.topic }}", days=30)
          if item.explicit or freq >= policies.promotion.remention_min or (nov >= policies.promotion.novelty_threshold and use >= policies.promotion.usefulness_min):
            emit("approved", { text: item.text, topic: item.topic, embedding: e })

      - name: upsert_ltm
        when: "has_event('approved')"
        uses: "stores.ltm"
        with:
          op: "upsert"
          vector: "{{ event('approved').embedding }}"
          payload:
            user_id: "{{ user_id }}"
            text: "{{ event('approved').text }}"
            topic: "{{ event('approved').topic }}"
            salience: 0.8
            confidence: 0.7
            last_used_at: "{{ now() }}"

  answer:
    trigger: "http:POST:/answer"
    input: { user_id: string, session_id: string, question: string }
    steps:
      - name: q_embed
        uses: "models.embed"
        with: { text: "{{ question }}" }
        out: "qv"

      - name: ltm_search
        uses: "stores.ltm"
        with:
          op: "search"
          vector: "{{ qv }}"
          limit: 12
          filter: { user_id: "{{ user_id }}" }
        out: "cands"

      - name: rerank
        uses: "models.reranker"
        with: { query: "{{ question }}", documents: "{{ cands.payloads }}" }
        out: "ranked"

      - name: guard
        uses: "models.llm"
        with:
          prompt: "{{ prompts.retrieval_guard }}"
          input: "{{ question }}\n---\n{{ ranked }}"
        out: "ctx"

      - name: respond
        uses: "models.llm"
        with:
          prompt: |
            あなたは有能なアシスタントである。以下のコンテキストのみを根拠に、
            質問に日本語・だ調で簡潔に答えよ。不足は明示せよ。
            コンテキスト:
            {{ ctx }}
            質問:
            {{ question }}
        out: "answer"

      - name: touch_used
        uses: "stores.ltm"
        with: { op: "touch", ids: "{{ ids(ctx) }}" }

  update_persistent:
    trigger: "event:pm_updates"
    steps:
      - name: upsert_pm
        uses: "stores.pm"
        with:
          op: "upsert"
          table: "user_profile"
          row:
            user_id: "{{ user_id }}"
            key: "{{ item.key }}"
            value_json: "{{ item.value_json }}"
            pii_flag: "{{ item.pii_flag }}"
            consent: true
            version: "{{ semver_inc(item.key) }}"
            updated_at: "{{ now() }}"
      - name: log_consent
        uses: "stores.pm"
        with:
          op: "insert"
          table: "consent_log"
          row: { user_id: "{{ user_id }}", key: "{{ item.key }}", ts: "{{ now() }}", source: "chat" }

  nightly_maintenance:
    trigger: "cron: 0 3 * * *"
    steps:
      - name: decay
        run: |
          decay_ltm_scores(warm=policies.decay.warm_days, cool=policies.decay.cool_days)
      - name: archive
        run: |
          archive_to_object_store(select_ltm(last_used_gt=policies.decay.archive_days))
      - name: purge
        run: |
          delete_ltm(last_used_gt=policies.decay.delete_days)

  privacy_portal:
    trigger: "http:POST:/privacy"
    input: { user_id: string, action: enum[export,delete] }
    steps:
      - name: export
        when: "{{ action == 'export' }}"
        run: |
          zip_uri = export_user_bundle("{{ user_id }}")
          emit("export_uri", zip_uri)
      - name: delete
        when: "{{ action == 'delete' }}"
        run: |
          purge_pm("{{ user_id }}"); purge_ltm("{{ user_id }}"); purge_audit("{{ user_id }}")
```

## 5. 実装メモ（Codex向け）

- `/ingest` と `/answer` エンドポイントを中心に、Mastra Workflowのトリガーとハンドラを実装する。
- `token_count`、`stm_tail`、`count_mentions`、`novelty_score`、`recent_usefulness`、`decay_ltm_scores`、`archive_to_object_store`、`export_user_bundle` は抽象関数として定義し、後続の自動生成対象とする。
- ベクトルDBは Qdrant / Weaviate / pgvector など、`stores.ltm` の接続層を差し替えることで対応。
- Mastraの Memory / Working Memory / Workflow 機能の標準的な利用フローに沿って実装する。

Titansの「短期×長期メモリ」の思想と恒久プロファイルの分離を満たす最小構成であり、Mastraを用いたAIアシスタントに記憶機能を与える際のベースラインとして利用できる。
