This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can import the Partnerships skillz data from [test-data](/test-data/skill-matrix-v1-2026-04-04T06-55-19-320Z.json). The file format is essentially:

```json
{
  "format": "skill-matrix-export",
  "version": 1,
  "exportedAt": "2026-04-04T06:55:19.317Z",
  "data": {
    "skills": [
      "UI",
    ],
    "members": [
      "Ayelen",
    ],
    "projects": [
      "Google Classroom Add-On",
    ],
    "projectAssignments": {
      "Google Classroom Add-On": {
        "skills": [
          "Auth",
        ],
        "members": [
          "Ayelen",  
        ]
      },
    },
    "matrix": {
      "Ayelen||UI": 2,
    },    
  },
}

```

### Local autosave snapshot

While the app is running, it writes an autosave snapshot every 60 seconds to:

- `test-data/skill-matrix-autosave.json`

This is a temporary collaboration step before syncing the JSON to GCS.


You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel (with password protection)

This app is ready to deploy on Vercel as-is (including the `app/api/state-snapshot` route).

### 1) Deploy the app

From the repo root:

```bash
npx vercel
```

Then follow the prompts:

- Link to your Vercel account/team
- Confirm the project name
- Keep defaults for:
  - Build command: `npm run build`
  - Output: Next.js

After the first deploy, production deploys can be done with:

```bash
npx vercel --prod
```

### 2) Turn on password protection

In the Vercel dashboard:

1. Open your project.
2. Go to **Settings** -> **Deployment Protection**.
3. Enable **Password Protection**.
4. Set and save the password.

Only people with that password can open the site URL.

### 3) Share the URL

Give teammates the production URL and password. The app can stay online even when your laptop is off.

### Notes

- Data in this app is currently stored in each user's browser (`localStorage`), so users do not automatically share one common dataset.
- The app also writes autosave snapshots server-side to `test-data/skill-matrix-autosave.json` when the API route is reachable.
