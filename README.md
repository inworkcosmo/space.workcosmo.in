# Workcosmo Space

Customer-facing identity and module launcher for Workcosmo OS.

## Domain

Deploy this folder to:

```text
space.workcosmo.in
```

## Flow

1. Customer signs in with Client ID, email, and password.
2. Space validates `/users/{uid}` and `/companies/{companyId}`.
3. Space renders company profile, role, plan, and enabled modules.
4. Live modules launch to their product subdomains, starting with:

```text
https://hire.workcosmo.in/{companyId}
```

## Local Dev

```bash
npm install
npm run dev
```
