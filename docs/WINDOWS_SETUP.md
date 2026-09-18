# Windows development setup

## A. Database change
Open pgAdmin Query Tool on `colorshine_mes` and run:

`backend/sql/09_app_security.sql`

## B. Backend
Open PowerShell:

```powershell
cd <project>\backend
Copy-Item .env.example .env
notepad .env
npm install
npm run seed:admin -- --user ADMIN --password "Choose-A-Strong-Password"
npm run dev
```

Test: open `http://localhost:3000/health`.

## C. Frontend
Open a second PowerShell:

```powershell
cd <project>\frontend
Copy-Item .env.example .env
npm install
npm run dev
```

Open `http://localhost:5173` and sign in as `ADMIN`.

## D. Network/tablet testing
For tablet/mobile testing on the same LAN, start Vite with:

```powershell
npm run dev -- --host 0.0.0.0
```

Set `VITE_API_URL` to the backend server's LAN IP, e.g. `http://192.168.1.50:3000/api`, and set backend `CORS_ORIGIN` to the frontend URL.

Do not expose the development server directly to the internet. Production deployment will use Nginx/HTTPS and a service manager.
