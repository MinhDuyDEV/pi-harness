# Config Schema for pikit-translate

## Sections

### `preferences`

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `target_language` | string | `vi-VN` | Target language code (BCP-47: `vi-VN`, `en`, `ja`, `ko`, `fr`, `de`, `es`) |
| `default_mode` | enum | `normal` | `quick` — direct translate. `normal` — analyze then translate. `refined` — analyze → draft → review → revise → polish |
| `audience` | string | `general` | Target reader: `general`, `technical`, `academic`, `business`. Custom descriptions also accepted (e.g., `AI-interested general readers`) |
| `style` | string | `storytelling` | `storytelling`, `formal`, `technical`, `literal`, `academic`, `business`, `humorous`, `conversational`, `elegant`. Custom also accepted |
| `chunk_threshold` | number | `4000` | Word count at which chunked parallel mode activates |
| `chunk_max_words` | number | `5000` | Max words per chunk (only relevant when chunking) |
| `output_base_dir` | string | `translate` | Base output directory relative to cwd |
| `verbose` | boolean | `false` | Log detailed progress information |

### `glossary`

Key-value pairs of terms and their translations. Inline entries override built-in glossary entries.

```
## glossary
API: 应用程序接口
latency: 延迟
throughput: 吞吐量
```

### `glossary_files`

List of external glossary file paths (relative to the config.md location) to merge.

```
## glossary_files
- ./project-glossary.md
- ~/.pi/agent/config/glossaries/tech-terms.md
```
