# dsh-answered-questions · Answered Questions for DeepSeek Harness

English | [简体中文](https://github.com/Ryuu-64/dsh-answered-questions/blob/main/README.zh-CN.md)

Keep the question, every option, and your answer visible in **DeepSeek Harness (DSH)** after you reply. Return to a conversation later and see what you chose, along with the alternatives.

## See it in action

After you answer a multiple-choice question, the card keeps your selections, the unselected options, and any extra text you entered. It uses DSH's native styling.

![Full DSH chat showing an answered multiple-choice question with selected and unselected options and an additional written answer](https://raw.githubusercontent.com/Ryuu-64/dsh-answered-questions/main/docs/screenshots/answered-multi-select-desktop.png)

*Recorded in DSH 0.2.2-rc.3 with an example conversation and the current source version. The interface is in Simplified Chinese.*

## Version and installation

**The current source version is 0.1.3. It has not been published to npm.** Install a local package using the steps below; installing by package name is not available yet.

Supported DSH versions: **0.2.1-rc.3 and 0.2.2-rc.3**. Start with a working DSH chat setup. The DSH 0.2.2-rc.3 CLI requires **Node.js 24.9.0 or a later 24.x release**. Install [`@machine202502/dsh-choice@0.1.2`](https://www.npmjs.com/package/@machine202502/dsh-choice) separately only if you want to use `ask_user_choice` cards.

To install from source, you need Git, npm, and the `dsh` and `pnpm` commands available in your terminal.

1. Clone the repository, install its dependencies, and build:

   ```sh
   git clone https://github.com/Ryuu-64/dsh-answered-questions.git
   cd dsh-answered-questions
   npm ci --ignore-scripts --legacy-peer-deps
   npm run build
   ```

2. Create an output directory outside the repository. Replace the placeholder below with its absolute path:

   ```sh
   npm pack --pack-destination "<output-directory-outside-repository>"
   ```

3. Install the generated `.tgz` file. This command targets the `web` profile used by DSH Web; replace the path with the file created in the previous step:

   ```sh
   dsh plugin --profile web add "<output-directory>/ryuu-64-dsh-answered-questions-0.1.3.tgz"
   ```

4. Keep the `.tgz` file because the profile references it. Restart that DSH service, refresh the page, and confirm **Answered Questions** is enabled under **Plugins**. For the desktop app, use the plugin installation entry provided by that version instead of the `web` profile.

### Updates

To update a local package, build and pack the new source, install the new `.tgz`, and restart DSH. Local packages do not receive npm update notifications.

Once the plugin is published to npm, npm installations can use **Plugins → Answered Questions → Versions** in DSH 0.2.2-rc.3 to check for and install updates. If your host does not offer this section, reinstall a compatible version manually. See the [DSH update documentation](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.3/packages/client/ui-plugin-manager/README.md#updating-a-bundle).

## Try it

Ask the assistant to use the native question tool, for example:

> Use ask_user_question to ask which fruits I want to bring. Let me select more than one and add anything else I want to bring.

1. Select two options in DSH's question panel, add a written answer, and submit.
2. Return to the chat. The complete card keeps both selections, the other options, and your text.
3. Refresh or reopen the conversation to review your answer again. Load earlier history if the question is not yet visible. When a request contains several questions, use the arrows at the bottom of the card to move between them.

With `dsh-choice`, click an option on the choice card to send your answer. After submission, all options remain visible and your selection stays marked:

![Full DSH chat showing a choice card with all routes preserved and the selected riverside route highlighted](https://raw.githubusercontent.com/Ryuu-64/dsh-answered-questions/main/docs/screenshots/answered-choice-desktop.png)

*Shown with the interface in Simplified Chinese. The choice card comes from dsh-choice; Answered Questions preserves and restores selections submitted through this plugin.*

## What stays visible

| Question type | What you can review |
| --- | --- |
| Native single choice | The question, all options, and the selected option or written answer |
| Native multiple choice | The question, all options, checked selections, and extra text |
| Free text or skipped question | The original text or an explicit unanswered state |
| `dsh-choice` card | Text, image, or audio options, plus the selected option or “none of these” |

The plugin works automatically when enabled and needs no extra configuration. Open images to view them, or play audio manually.

- **Existing native questions can be reviewed** if DSH saved the complete question and result. Missing records are not filled with invented answers.
- **Old choice-card answers cannot be recovered automatically.** Earlier text without a link to its question is not treated as a recorded selection. Choosing again sends a new answer.
- **Submitted and queued does not mean answered.** The card shows an answer only after it enters the conversation history. If you remove a pending answer from the queue, you can choose again.
- **The plugin reads records from the current DSH connection** and does not send answers to an external model for processing. If a remote image or audio file becomes unavailable, the choice record remains, but the media may no longer open.

DSH 0.2.2-rc.3 also has short answer bubbles. When a complete review card is available, the plugin hides the corresponding bubble to avoid showing the answer twice.

## Feedback and further reading

Report problems in [GitHub Issues](https://github.com/Ryuu-64/dsh-answered-questions/issues), including your DSH version, question type, and steps to reproduce. Leave out secrets and private conversations.

- [Compatibility and history limits (Chinese)](https://github.com/Ryuu-64/dsh-answered-questions/blob/main/docs/compatibility.md)
- For development, run `npm run build` and `npm run check`. Browser regression tests are in [`scripts/e2e.mjs`](https://github.com/Ryuu-64/dsh-answered-questions/blob/main/scripts/e2e.mjs).
- [Acknowledgments](https://github.com/Ryuu-64/dsh-answered-questions/blob/main/NOTICE.md) · [MIT license](https://github.com/Ryuu-64/dsh-answered-questions/blob/main/LICENSE)
