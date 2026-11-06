# Meet Notes: Chrome Web Store listing

## Basics

- **Name:** Meet Notes
- **Category:** Productivity
- **Short description (max 132 chars):** Record a Google Meet and get a Persian summary, English notes and a transcript. Your key, your data, no account.
- **Single purpose:** Record the Google Meet meeting the user chooses and turn it into a transcript, a summary and meeting notes.

## Detailed description

Meet Notes records a Google Meet meeting when you press Start and, when you press Stop, turns it into:

- a **Summary** (Persian, with English technical terms kept as spoken) ready to paste into an email,
- **AI notes** (English) following a template for your meeting type: Grooming, Planning, Technical or Daily,
- a **Transcript** with speaker names and timestamps,
- **Screens**: images of the Meet tab (the shared screen and participants' video) when the picture changes; up to 60 per meeting are sent to OpenRouter to be described, each with a short description.

How it works: setup takes three steps (your OpenRouter key, your name in Meet, and optionally a services folder so notes use your real service names; an optional switch, “Suggest where to change the code”, also searches that folder's code and sends short snippets of matching lines, with secrets masked, to OpenRouter with the meeting). Processing runs inside Chrome and uses your own OpenRouter key, so there is no Meet Notes account and no Meet Notes server. If you close Chrome mid-processing, it resumes when you reopen it.

Privacy: audio and screenshots go only to OpenRouter to make your notes. Screenshots are images of the Meet tab (the shared screen and participants' video) when the picture changes; up to 60 per meeting are sent to OpenRouter to be described. Everything else stays in your browser. No analytics, no tracking. Nothing is emailed or shared unless you click Copy or Open in Gmail.

Typical cost is about $0.10 to $0.20 for a one-hour meeting, paid to OpenRouter with your own key.

Please tell the people in your meeting that you are recording.

## Permission justifications

- **tabCapture:** captures the audio of the Google Meet tab, only after the user presses Start, so it can be transcribed.
- **activeTab:** reads the title and address of the current tab when the user opens the popup, to pre-fill the meeting title and to start capture of that tab from the user's click.
- **offscreen:** an offscreen document keeps the recording and the long-running processing alive after the popup closes, and plays the meeting audio back to the user while recording.
- **storage:** stores the user's settings and setup progress.
- **unlimitedStorage:** meetings (audio and screenshots) are stored in the browser and can exceed the default quota; a one-hour recording is tens of megabytes.
- **notifications:** shows "notes ready" or "needs attention" when processing finishes while the popup is closed.
- **downloads:** saves the user's requested downloads: the notes .zip, the transcript and the audio of a failed meeting.
- **Host permission `https://openrouter.ai/*`:** the only service the extension sends data to; used to transcribe, describe screenshots (images of the Meet tab: the shared screen and participants' video) and write the notes with the user's own key, and to check the key's remaining credit.
- **Content script on `https://meet.google.com/*`:** reads the names of the participants who are speaking on the Meet page so the transcript can label speakers. It does not read chat or any other page content and sends nothing by itself.
- **Optional host permission `http://127.0.0.1:47821/*`:** requested at runtime only if the user turns on "Local helper" (an advanced mode); connects to a helper program on the user's own computer.

## Data usage disclosures (Privacy tab)

- **Data types collected:** Website content (audio of the meeting; screenshots, i.e. images of the Meet tab (the shared screen and participants' video) when the picture changes; up to 60 per meeting are sent to OpenRouter to be described; participant names on the Meet page); Authentication information (the user's OpenRouter API key); Personal communications (meeting audio and transcripts). Tick nothing else.
- **Is data sold to third parties?** No.
- **Used or transferred for purposes unrelated to the single purpose?** No.
- **Used or transferred to determine creditworthiness or for lending?** No.
- **Where does it go?** Only to OpenRouter (to make the notes), using the user's own key: the audio, up to 60 screenshots of the Meet tab per meeting (shared screen and participants' video), speaker names and the optional services text. If the user turns on “Suggest where to change the code”, short snippets of matching lines from the services folder's code (secrets masked; config files only by name) are also sent, only for grooming, planning and technical meetings. Everything else stays in the user's browser.
- **Certify:** Limited Use compliance, and that the data usage follows the Developer Program Policies.
- **Privacy policy URL:** publish `docs/privacy-policy.md` (for example on GitHub Pages) and paste its URL. Fill in the contact email first.

## Screenshots (1280x800, at least one, up to five)

- [ ] Setup, step 1 (OpenRouter key connected)
- [ ] Popup in Idle with type chips and Recent meetings
- [ ] Popup while recording (timer and Stop)
- [ ] Meeting page: Summary tab (Persian)
- [ ] Meeting page: AI notes tab
- [ ] Optional: promo tile 440x280; the 128x128 icon is `extension/icons/128.png`

## Third-party licences

The package bundles `@breezystack/lamejs` (MP3 encoder), licensed **LGPL-3.0**, plus `marked` (MIT) and `fflate` (MIT). `THIRD_PARTY_NOTICES.md` is included in the package zip and lists them with their full licence texts (MIT for both, LGPL-3.0 and the GPL-3.0 it incorporates). The LGPL library is used unmodified, its source is public (https://github.com/breezystack/lamejs), and the project's source and `package-lock.json` let anyone rebuild with a replacement. Keep the notices file in every upload.
