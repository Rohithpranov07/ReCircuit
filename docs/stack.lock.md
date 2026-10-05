# Stack lock

Versions verified against the package registries and release pages on **2026-10-05**.
Constraints come from build playbook §B.6; "latest compatible" means newest release that satisfies them.

## Database and tooling

| Component | Version | Source / note |
| --- | --- | --- |
| PostgreSQL | 16.x (image `postgres:16`) | Docker Hub tag exists; major version fixed by the spec |
| pgcrypto, btree_gist | bundled with PostgreSQL 16 | contrib extensions |
| dbmate | v2.36.0 | GitHub releases (amacneil/dbmate) |
| pgTAP | v1.3.4 | GitHub releases (theory/pgtap); `CREATE EXTENSION pgtap` is verified in T1.6/T1.8 once a database is running |
| k6 | v2.3.0 | GitHub releases (grafana/k6) |

## API (Python 3.12)

| Package | Version | Note |
| --- | --- | --- |
| Python | 3.12 | runtime pinned by the spec (container image `python:3.12`) |
| fastapi | 0.142.2 | PyPI |
| uvicorn | 0.54.0 | PyPI |
| pydantic | 2.13.5 | v2 line |
| psycopg[binary,pool] | 3.3.6 (psycopg-pool 3.3.3) | 3.x line |
| pyjwt | 2.15.1 | PyPI |
| passlib[bcrypt] | 1.7.4 | PyPI, latest release |
| bcrypt | 4.0.1 (pinned) | passlib 1.7.4 is unmaintained and breaks with bcrypt >= 4.1 (missing `__about__`) and bcrypt 5 (rejects its >72-byte self-test). Pin to the last known-good 4.0.x; re-confirmed in T3.3 against the installed package before relying on it |
| qrcode[pil] | 8.2 (pillow 12.3.0) | PyPI |
| slowapi | 0.1.10 | PyPI |
| pytest | 9.1.1 | PyPI |
| pytest-asyncio | 1.4.0 | PyPI |
| httpx | 0.28.1 | PyPI |
| testcontainers[postgres] | 4.15.0 | PyPI |
| ruff | 0.16.10 | PyPI |
| mypy | 2.4.0 | PyPI, run with `--strict` |

## Web (Node 20 LTS)

| Package | Version | Note |
| --- | --- | --- |
| Node.js | 20.20.2 | latest 20.x LTS; local machine has 22.x, CI and containers use 20 |
| react / react-dom | 18.3.1 | spec fixes React 18 (latest 19.x is not used) |
| typescript | 5.9.3 | latest 5.x; typescript-eslint 8.71.0 supports `>=4.8.4 <6.1.0`, so 7.x is excluded |
| vite | 6.4.3 with @vitejs/plugin-react 4.7.0 | plugin-react 6.x requires vite 8 (a different toolchain); 4.7.0 supports vite 6/7 and React 18 |
| typescript-eslint | 8.71.0 | peer eslint ^8.57 \|\| ^9 \|\| ^10 |
| tailwindcss | 4.3.3 | npm |
| @tanstack/react-query | 5.104.1 | peer `react ^18 \|\| ^19` |
| react-router-dom | 7.18.4 | peer `react >=18` |
| html5-qrcode | 2.3.8 | npm |
| recharts | 3.10.1 | peer allows React 18 |
| @playwright/test | 1.63.0 | npm |
| eslint | 10.12.0 | npm; satisfies typescript-eslint 8.71.0 peer range |

## CI

| Component | Version |
| --- | --- |
| GitHub Actions runner | ubuntu-latest |
