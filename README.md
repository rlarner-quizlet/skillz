This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can import the Partnerships skillz data from [test-data](/test-data/skill-matrix-v1-2026-04-04T07-21-05-085Z.json). The file format is essentially:

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


You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
