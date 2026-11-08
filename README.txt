JARVIS — UPDATED REPLACEMENT PROJECT

This is a complete replacement front end and backend. It removes Google OAuth and uses manual calendar entries saved in this browser. It adds a tasks area, a training log, an AI chat, app installation metadata, and backup import/export.

FILES
- index.html: application interface and browser-side logic
- api/chat.js: secure Groq chat endpoint
- manifest.json + sw.js: installable web app and static app-shell caching
- jarvis-logo.svg: horizontal supplied-style Jarvis logo
- icons/: square home-screen and browser icons
- vercel.json: serverless function duration configuration

DEPLOY TO YOUR EXISTING VERCEL PROJECT
1. Download and unzip this archive.
2. Replace the contents of your GitHub repository with the files and folders in this archive. Keep the api and icons folders in the repository root. This is a full replacement, not a small patch.
3. In Vercel, open your project → Settings → Environment Variables. Add GROQ_API_KEY and paste your Groq API key as its value. Do not put the key in index.html, GitHub, or any browser setting.
4. Apply the variable to Production (and Preview if needed), save, then redeploy.
5. Open the deployed site → Settings → Test AI connection.

IMPORTANT
- Google Calendar OAuth, Google sign-in, and Google Calendar API calls are removed. Events are entered manually inside Jarvis.
- Events, tasks, settings and training records are stored in localStorage on this browser/device. They do not sync across devices. Use Settings → Export backup regularly.
- Groq model defaults to openai/gpt-oss-20b. The model is configurable in api/chat.js.
- Groq usage may have free-tier limits and can become paid depending on usage and account plan. Vercel hosting and Groq inference are separate services.
- The included app icon uses PNG sizes for better iOS/Android shortcut compatibility.
- A basic per-instance rate limit is included, but Vercel serverless instances do not share memory; it is not a full abuse-prevention system.
