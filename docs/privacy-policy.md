# Meet Notes: Privacy Policy

Last updated: 2026-11-06

Meet Notes is a Chrome extension that records a Google Meet meeting you choose to record and turns it into a transcript, a summary and notes. This policy explains what it handles and where that data goes.

## What the extension handles

- **Meeting audio:** the audio of the Meet tab and your microphone, only while you have pressed Start.
- **Screenshots:** while you record, images of the Meet tab (the shared screen and participants' video) when the picture changes; up to 60 per meeting are sent to OpenRouter to be described.
- **Speaker names:** the names shown on the Meet page, used to label who spoke.
- **Your OpenRouter API key**, which you enter in setup.
- **Optional services-folder text:** if you choose a services folder, the extension reads folder names, the start of each README and package manifest names, so notes use the right service names. You choose the folder; the extension reads nothing else on your computer. If you turn on “Suggest where to change the code”, the paths of matching files and short snippets of matching lines from your folder's code (secrets masked; config files only by path, never their content) are sent to OpenRouter with the meeting. This runs only when the switch is on, your role is Technical and a folder is chosen, and only for grooming, planning and technical meetings. `.env` files, keys and lockfiles are never read.
- Your name, role, meeting titles and settings.

## Where the data goes

- **OpenRouter only.** To make your notes, the extension sends audio, screenshots (up to 60 images of the Meet tab per meeting, which can show the shared screen and participants' video), speaker names and the optional services text to OpenRouter (https://openrouter.ai), using your own API key. If you turn on “Suggest where to change the code”, it also sends the paths of matching files and short snippets of matching lines from your services folder's code (secrets masked). OpenRouter passes the request to the AI model you selected. OpenRouter's and the model provider's privacy terms apply to that processing.
- **Local helper mode (optional, off by default):** if you turn it on, recordings (audio, screenshots and speaker names) are sent to a local helper at a URL you set (default `http://127.0.0.1:47821`), meant to be a helper program on your own computer. That data does not leave your computer except as that helper's own calls.
- Nothing is sent anywhere else. There are no analytics, no telemetry and no crash reporting.
- Nothing is emailed, posted or shared unless you click an action such as "Open in Gmail" or "Copy".

## Storage

Everything is stored only in your own browser (IndexedDB and `chrome.storage.local`) on your computer. Your API key is stored in `chrome.storage.local`, not synced. We have no server and cannot see your data.

## Retention

- Audio is deleted automatically 30 days after the notes for that meeting are ready. Audio of a meeting that failed is kept until you retry successfully, download it or delete the meeting.
- Transcripts, notes, screenshots and settings stay until you delete them. "Delete all meetings" in Settings removes all meetings; removing the extension removes all of its data.

## No sale, no transfer

We do not sell or transfer user data to third parties, other than OpenRouter as described above, which is required for the extension's single purpose. We do not use or transfer data to determine creditworthiness or for lending, and we do not use it for advertising.

## Limited Use

The use of information received from Google APIs or collected through the extension will adhere to the Chrome Web Store User Data Policy, including the Limited Use requirements. Data is used only to provide the user-facing feature of making meeting notes; it is not used for advertising, is not sold, and is not read by humans except with your explicit permission, for security, or to comply with law.

## Contact

Questions: `<your email>`
