# 🌿 NAMC Tree — National Ayurveda Morbidity Codes

> **Published by [Namaste Ayush Portal](https://namaste.ayush.gov.in/ayurveda)**  
> Free and open-access interactive reference for Ayurveda practitioners, educators, researchers, and students worldwide.

An interactive hierarchical tree of **2387 NAMC codes** across **50 levels** — complete with Sanskrit terms, Devanāgarī script, diacritical forms, English names, and 1619 clinical definitions from the National Ayurveda Morbidity Codes (Ministry of AYUSH, Government of India).

[![Deploy](https://github.com/YOUR-USERNAME/namc-tree/actions/workflows/deploy.yml/badge.svg)](https://github.com/YOUR-USERNAME/namc-tree/actions/workflows/deploy.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)
[![Made by Namaste Ayush](https://img.shields.io/badge/Made%20by-Namaste%20Ayush%20Portal-orange)](https://namaste.ayush.gov.in/ayurveda)

---

## 📑 Table of Contents

- [Features](#-features)
- [Project Structure](#-project-structure)
- [Quick Start](#-quick-start-offline)
- [Deploy to GitHub Pages](#-deploy-to-github-pages)
- [GitHub Secrets Setup](#-github-secrets-setup)
- [Enable Live Google Sheets Sync](#-enable-live-google-sheets-sync)
- [Updating the Data](#-updating-the-data)
- [Usage Guide](#-usage-guide)
- [Credits and License](#-credits--license)

---

## ✨ Features

| Feature | Detail |
|---------|--------|
| 🌳 **Full Hierarchy** | 2387 nodes, 50 levels, colour-coded by depth |
| 📖 **Definitions** | 1619 nodes have full clinical definitions from NAMC |
| 🔍 **Full-text Search** | Searches codes, Sanskrit terms, Devanāgarī, and definition text |
| ✏️ **Editable** | Edit any node's definition, term, or transliteration |
| ➕ **Add Nodes** | Add new child or root nodes at any point in the hierarchy |
| 🗑 **Delete Nodes** | Remove nodes with confirmation; changes tracked for CSV export |
| 🔄 **Google Sheets Sync** | Live two-way sync via Apps Script API |
| 🔐 **Secrets via GitHub** | API keys injected at build time — never committed to code |
| ⬇ **CSV Export** | Download all data + edits; re-import into Excel or Google Sheets |
| 🌙 **Dark / Light Theme** | Toggle with one click |
| 📱 **Responsive** | Works on desktop, tablet, and mobile |
| 🆓 **Free** | GitHub Pages + Google Sheets + Apps Script = ₹0/month |

---

## 📁 Project Structure

```
namc-tree/
│
├── index.html                   Main page (HTML shell — no inline JS/CSS)
├── style.css                    All styles, themes, level colours
├── api.js                       Google Sheets connector (secrets injected at build)
├── store.js                     Local state, localStorage persistence, offline queue
├── tree.js                      Tree DOM engine: build, expand/collapse, search
├── app.js                       Main controller: boots all modules, wires UI
│
├── data.js                      All 2910 NAMC records as a JS object
├── tree_data.js                 Raw 2387-node tree HTML from original NAMC export
│
├── backend/
│   └── Code.gs                  Google Apps Script backend
│
├── scripts/
│   ├── build.sh                 Build: copies files and injects GitHub Secrets
│   └── generate_data_js.py      Regenerates data.js from updated Excel
│
├── .github/
│   └── workflows/
│       └── deploy.yml           GitHub Actions: auto-build and deploy on push
│
├── LICENSE                      MIT License — Namaste Ayush Portal
└── README.md                    This file
```

---

## 🚀 Quick Start (Offline)

No backend, build tools, or internet connection required.

```bash
git clone https://github.com/YOUR-USERNAME/namc-tree.git
cd namc-tree
open index.html        # macOS
xdg-open index.html   # Linux
start index.html       # Windows
```

All 2387 nodes load immediately. Edits save to browser localStorage.  
Use **⬇ Export CSV** to download changes and re-import into Excel.

---

## 🌐 Deploy to GitHub Pages

```bash
git add .
git commit -m "Initial NAMC tree deployment"
git push origin main
```

Then: **Repository → Settings → Pages → Source → GitHub Actions**

Your live URL:
```
https://YOUR-USERNAME.github.io/namc-tree/
```

---

## 🔐 GitHub Secrets Setup

Secrets keep your API keys out of the repository entirely.  
The build script reads them from GitHub Actions and injects them  
into `api.js` only inside the deployed `dist/` folder — they are  
**never written to any file in your repository**.

### Step 1 — Add Secrets

Go to: **Repository → Settings → Secrets and variables → Actions → New repository secret**

| Secret Name | Description |
|-------------|-------------|
| `APPS_SCRIPT_URL` | Your deployed Apps Script Web App URL |
| `NAMC_API_KEY` | A strong random key you generate (must match `Code.gs`) |
| `SHEET_ID` | Your Google Spreadsheet ID (from the sheet URL) |

Generate a strong API key:
```bash
python3 -c "import secrets; print(secrets.token_urlsafe(32))"
```

### Step 2 — How Secrets Flow

```
GitHub Secrets (never stored in files)
        │
        ▼
.github/workflows/deploy.yml   (reads secrets as env vars)
        │
        ▼
scripts/build.sh               (Python replaces placeholder tokens)
        │
        ▼
dist/api.js                    (contains real values — never committed)
        │
        ▼
GitHub Pages                   (served to users securely)
```

Your repository always contains safe placeholder tokens:
```javascript
// api.js in repo — always safe to commit
url:    '__APPS_SCRIPT_URL__',
apiKey: '__NAMC_API_KEY__',
```

### Step 3 — Trigger Deployment

```bash
git commit --allow-empty -m "Deploy with secrets"
git push
```

Watch progress at: **Actions → Build and Deploy NAMC Tree**

---

## 🔗 Enable Live Google Sheets Sync

### Step 1 — Import Excel into Google Sheets

1. [drive.google.com](https://drive.google.com) → **New → File Upload** → select the XLS file
2. Right-click the uploaded file → **Open with Google Sheets**
3. Google auto-converts it. Confirm the 12 columns are intact.
4. Copy the **Spreadsheet ID** from the URL:
   ```
   https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit
   ```
5. Add this as the `SHEET_ID` GitHub Secret.

### Step 2 — Deploy the Apps Script Backend

1. In Google Sheets: **Extensions → Apps Script**
2. Replace all default code with `backend/Code.gs`
3. Set the configuration at the top:
   ```javascript
   const SPREADSHEET_ID = '1RNGinbZoCU9g5nzr_32ghvKb3bwGvzDhZZRTDxaFBGY';
   const EDIT_API_KEY   = 'same-key-as-NAMC_API_KEY-secret';
   ```
4. **Deploy → New Deployment**
   - Type: **Web App**
   - Execute as: **Me**
   - Who has access: **Anyone**
5. Click **Deploy** and copy the **Web App URL**
6. Add this URL as the `APPS_SCRIPT_URL` GitHub Secret

### Step 3 — Push to Deploy

```bash
git push origin main
```

GitHub Actions injects secrets and deploys. All edits now sync to  
your Google Sheet in real time.

---

## 🔄 Updating the Data

When you update your Excel file:

```bash
# 1. Place the updated XLS/CSV in the project root

# 2. Regenerate data.js
python3 scripts/generate_data_js.py

# 3. Commit and push — Actions redeploys automatically
git add data.js
git commit -m "Update NAMC data $(date +%Y-%m-%d)"
git push
```

---

## 📖 Usage Guide

| Action | How |
|--------|-----|
| Open a node | Click any row |
| View definition | Click row → 📖 View tab |
| Edit a node | Click row → ✏️ Edit tab → save |
| Add a child node | Hover any row → **+** button |
| Add a root node | Header → **＋ Add Node** |
| Delete a node | Hover → **✕**, or Edit tab → Delete |
| Search | Type in the search box |
| Expand all | Header → **▶ Expand All** |
| Collapse to level | Header → **L2** or **L4** |
| Export CSV | Header → **⬇ Export CSV** |
| Toggle theme | Header → ☀ / 🌙 |

---

## 🛠 Tech Stack

| Layer | Technology | Cost |
|-------|-----------|------|
| Frontend | Vanilla HTML + CSS + JS | Free |
| Hosting | GitHub Pages | Free |
| Database | Google Sheets | Free |
| Backend | Google Apps Script | Free |
| CI/CD | GitHub Actions | Free |
| **Total** | | **₹0 / $0 per month** |

---

## 🙏 Credits & License

**Developed and published by**

> **Namaste Ayush Portal**  
> [https://namasteayush.in](https://namasteayush.in)  
> Bringing Ayurveda knowledge to everyone, freely.

**Data source**

> National Ayurveda Morbidity Codes (NAMC)  
> Ministry of AYUSH, Government of India  
> [https://ayush.gov.in](https://ayush.gov.in)

Released under the **MIT License** — see [LICENSE](./LICENSE).  
Free to use, copy, modify, and distribute. Attribution appreciated.

---

<div align="center">
  Made with ❤️ by <a href="https://namaste.ayush.gov.in/ayurveda">Namaste Ayush Portal</a><br/>
  <sub>Freely given to the Ayurveda community worldwide</sub>
</div>
