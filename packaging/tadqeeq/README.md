<div align="center">

# تدقيق · Tadqeeq

**Turn an Islamic lecture into a clean transcript in which every Quranic verse, hadith and dhikr is found, checked and captioned.**

<img src="docs/screenshots/lecture-light.png" alt="Tadqeeq: a lecture transcript with the verses it quotes highlighted, next to the video" width="100%">

</div>

## What you can do with it

- **Bring a lecture in.** Paste its text, drop a `.txt`, `.srt` or `.vtt` file, paste a YouTube link, or upload an audio or video file.
- **Get the quotes found for you.** Every verse of the Quran (all 6,236, in the ten Qira'at), about 39,700 hadiths and a list of adhkar are searched for you, even when the speaker quotes only part of them.
- **Let AI check them.** With an optional free key, an AI model tells real quotes apart from the speaker's own words. It also flags a quote whose start or end was cut off.
- **Fix anything by hand.** Click a word to jump to it in the video. Add a quote that was missed, move a quote's edges, and undo or redo any change.
- **Export captions.** Download `SRT`, `VTT` or `ASS` subtitles. A verse or hadith is never split across two captions.
- **Write it up (Tafrigh).** Turn the transcript into a structured lesson with headings, the text studied and its explanation, then export it as Markdown, HTML or JSON.

Everything stays on your computer. The app runs in your browser, in Arabic or English, with a light and a dark theme.

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/lectures.png" alt="The lectures screen"><br><sub><b>Lectures:</b> paste text, a subtitle file, a YouTube link or a recording</sub></td>
    <td width="50%"><img src="docs/screenshots/editor.png" alt="The editor"><br><sub><b>Edit:</b> select words to add a quote that was missed</sub></td>
  </tr>
  <tr>
    <td colspan="2"><img src="docs/screenshots/lecture-dark.png" alt="A lecture in the dark theme"><br><sub><b>Dark theme</b></sub></td>
  </tr>
</table>

## Start it

You need three free tools. Install them once:

| Tool | Why | Get it |
|---|---|---|
| **Node.js** 22.18 or newer | builds the app's screens | [nodejs.org](https://nodejs.org) (the LTS version) |
| **ffmpeg** | reads audio and video | Ubuntu/Debian: `sudo apt install ffmpeg` · macOS: `brew install ffmpeg` |
| **uv** | installs Python for the app | `run.sh` offers to install it for you |

Then download the app and start it:

```bash
git clone https://github.com/AbderrahimZineddineEsi/tadqeeq.git
cd tadqeeq
./run.sh
```

The first start takes a few minutes: it installs everything and downloads the Quran and hadith texts (about 90 MB). After that it starts in seconds. Your browser opens **http://127.0.0.1:8000** on its own. Press `Ctrl+C` in the terminal to stop the app.

**On Windows**, install [WSL](https://learn.microsoft.com/windows/wsl/install) (Ubuntu), open the Ubuntu terminal and follow the same steps.

## Your first lecture in one minute

1. On the **Lectures** screen, click **Sample lecture**. The verses and hadiths it quotes are highlighted right away.
2. Click a highlighted quote to see where it comes from. Open **Edit** to change it, or **Export** to download captions.
3. To use your own lectures, paste text, a YouTube link or a file on the same screen.

## Keys (optional and free)

Pasted text and subtitle files work with no key at all. Keys unlock the cloud features. Paste them on the **Settings** screen; they are saved only on your computer, in the `.env` file.

| Key | What it unlocks | Where to get it |
|---|---|---|
| **Groq** | Transcribing audio, video and YouTube links (fast, free tier) | [console.groq.com/keys](https://console.groq.com/keys) |
| **Gemini** | AI checking of quotes and Tafrigh (free tier) | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| **OpenRouter** | Use any of hundreds of other AI models instead (paid per use) | [openrouter.ai/keys](https://openrouter.ai/keys) |

Before any AI run, the app shows how many requests it will send and what they will cost, so nothing is spent by surprise.

**No internet key for transcription?** If you have an NVIDIA graphics card (3 GB is enough), you can transcribe on your own computer instead: start the app with `WAHY_EXTRAS="local-asr" ./run.sh`.

## More options

| Want | Do |
|---|---|
| another port | `PORT=9000 ./run.sh` |
| open it from your phone or another computer on the same network | `HOST=0.0.0.0 ./run.sh`, then open `http://<this computer's IP>:8000` |
| don't open the browser | `NO_BROWSER=1 ./run.sh` |
| where your data is | the `data/` folder (lectures, database, downloaded media). Back it up to keep your work. |

## Problems?

- **"Node.js is too old"**: install the LTS version from [nodejs.org](https://nodejs.org) and run `./run.sh` again.
- **Audio or YouTube fails**: check that `ffmpeg` is installed (`ffmpeg -version`) and that a Groq key is set in **Settings**.
- **The app shows an error**: open its **Error report** and press **Copy**, then paste it into a [new issue](https://github.com/AbderrahimZineddineEsi/tadqeeq/issues).

## For developers

```bash
scripts/dev.sh     # hot reload: server on :8120, web app on :5173
scripts/test.sh    # every test: server (pytest, ruff), engine (vitest), web (vitest, tsc, eslint, Playwright)
```

`server/` is the FastAPI backend (Python 3.12), `engine/` is the quote detection and caption builder (TypeScript, run by Node), and `web/` is the React app. With the app running, the API documents itself at http://127.0.0.1:8000/docs.

## Credits

Built on [faster-whisper](https://github.com/SYSTRAN/faster-whisper), [Groq](https://groq.com), [FastAPI](https://fastapi.tiangolo.com), [React](https://react.dev) and [yt-dlp](https://github.com/yt-dlp/yt-dlp), with the corpus from the Wahy-Finder project.
