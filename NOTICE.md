# Acknowledgements

The plugin uses DeepSeek Harness public Conversation, Slot, locale, Session, and
Typert APIs. Its visual styling follows DSH's native user-question components and
uses the host's theme tokens.

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), MIT,
  Copyright (c) 2026 DeepSeek. Native event interpretation and native style
  conventions are informed by its `ui-user-questions` package. The MIT license
  terms are reproduced in this project's LICENSE.
- [dsh-choice](https://github.com/machine202502/dsh-choice), by machine202502.
  Compatibility targets its `ask_user_choice` 0.1.2 argument and media-result
  formats. The original package provides the model tool; this package provides
  its own optional presentation and reply persistence.
- [dsh-session-tools](https://github.com/Ryuu-64/dsh-session-tools) and
  [dsh-find-all](https://github.com/Ryuu-64/dsh-find-all), maintained by Ryuu-64,
  informed the bundle packaging and remote registration conventions.
