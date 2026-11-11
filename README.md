# freya-ns-api

REST API server on Express 5 and MongoDB (Mongoose 9). Requires Node.js 22 or newer.

## Running

```
npm install
npm start        # or: npm run dev (restarts on change)
```

Settings live in `config/config.js`; each one can be overridden with a `FREYA_*`
environment variable (for example `FREYA_SECRET`, `FREYA_DB_URI`, `FREYA_HTTP_PORT`).
Outside of `DEV` the server refuses to start with the default secret.

On the first start, when there are no users yet, an admin account is created
(`FREYA_ADMIN_USER`, default `admin`). Set `FREYA_ADMIN_PWD` to choose its password;
otherwise a random one is printed once to the console.

## Endpoints

All paths are under `/api`. Send the token as `Authorization: Bearer <token>`.

| Method | Path | Who | Purpose |
| --- | --- | --- | --- |
| GET | `/` | anyone | Welcome message and version |
| POST | `/auth/login` | anyone | `{ username, password }` → token (username may be the e-mail) |
| GET | `/auth/me` | signed in | The current user |
| POST | `/auth/logout` | signed in | Revokes all tokens of the current user |
| GET | `/users` | admin | List; query: `page`, `limit` (max 100), `q`, `role`, `active`, `sort` (e.g. `-createdAt`) |
| POST | `/users` | admin | Create: `{ username, email, password, displayName?, role?, active? }` |
| GET | `/users/:id` | admin or self | Read one user |
| PATCH | `/users/:id` | admin or self | Update. Self: `email`, `displayName`. Admin also: `username`, `role`, `active` |
| PUT | `/users/:id/password` | admin or self | `{ newPassword, currentPassword }` (`currentPassword` is required for your own account) |
| DELETE | `/users/:id` | admin | Delete |

Roles are `admin` and `user`. The last active admin cannot be deleted, demoted or deactivated.
Changing a password, deactivating or deleting a user invalidates that user's tokens immediately.

Errors are returned as `{ "error": "...", "details": { ... } }` with a matching HTTP status.
