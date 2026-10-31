# Hosting

***English** · [Deutsch](hosting.de.md)* · [← Overview](../readme.md)

- [Running with Node](#running-with-node)
- [Running with Docker](#running-with-docker)
- [Access and accounts](#access-and-accounts)
- [What the sign-in withstands](#what-the-sign-in-withstands)
- [Behind a reverse proxy](#behind-a-reverse-proxy)
- [Settings](#settings)
- [Data](#data)

## Running with Node

Requires Node 22 or newer (26 recommended).

```
npm install
npm run users -- add captain   # create access, the password is printed
npm start                      # http://localhost:8080
```

While developing, where only you play, `HO_AUTH=off npm start` takes the sign-in
away; `npm run dev` restarts the server on every change. The port can be set via
`PORT` (`PORT=3000 npm start`).

## Running with Docker

```
mkdir -p data                      # create it first, or it ends up owned by root
docker compose up -d --build       # http://localhost:8080
docker compose logs -f             # server output
docker compose down                # stop
```

The host port can be moved with `HOST_PORT` (`HOST_PORT=3000 docker compose up -d`);
inside the container the server still listens on 8080. The tests run in the same
image:

```
docker compose --profile test run --rm test
```

Inside the container the sign-in is on. Locally, switch it off with a `.env` next
to `docker-compose.yml` (template: `.env.example`):

```
HO_AUTH=off
```

On a server that line does not belong – without it the sign-in stays on. Whether it
is on is in the startup log (`docker compose logs ho | grep Zugang`).

## Access and accounts

A sign-in with user name and password sits in front of the lobby. Without a valid
session the server hands out neither the game client nor the WebSocket – the game
runs over the WebSocket, so a sign-in guarding only the page would be no sign-in at
all.

Accounts come and go on the host, not in the browser:

```
docker exec ho node server/users.js add captain                # rolled password
docker exec ho node server/users.js add captain secret-enough   # or one of your own
docker exec ho node server/users.js list                       # who may play
docker exec ho node server/users.js passwd captain             # reset a password
docker exec ho node server/users.js name captain Captain       # spelling of the account name
docker exec ho node server/users.js del captain                # delete an account
docker exec ho node server/users.js admin captain              # make an admin (… admin captain off)
docker exec ho node server/users.js inviter captain            # allow inviting (… inviter captain off)
docker exec ho node server/users.js block captain              # block an account (… block captain off)
```

Without Docker it is the same, only shorter: `npm run users -- add captain`.

- `add` prints the first password **once** – the only moment it exists in the
  clear. It is good for the first sign-in only; after that the player chooses their
  own before reaching the lobby. Same after `passwd`.
- Players change their password themselves at any time: *Change password* next to
  *Sign out* in the start menu. The current password is asked for again; every
  other session of the account ends, the browser in use stays signed in.
- Players also delete their account themselves (right to erasure): *Delete
  account* in the start menu, after asking twice and with their password. The
  account and its profile picture are deleted, every session ends. Admins cannot
  delete themselves – take away the admin flag first or remove them with `del`.
- `del` takes effect right away, even mid-game: HTTP requests are refused from the
  next one on, and an open WebSocket is dropped within a second. The account's
  profile picture is deleted with it. Resetting a password likewise ends every
  session.
- `admin` marks an account as **admin** of the instance. Admins play like everyone
  else, but their start screen gets an extra panel: every game on the server (state,
  turn, since when, who plays with which account) and every account (online or not,
  in which game). From there an admin can **watch** any running game – without
  fog of war and without touching its pace; games with humans keep waiting for
  their players – send a **message** to everyone in a
  game – e.g. to announce downtime; it appears as a banner that players have to
  acknowledge – and **end** any game (two clicks);
  everyone in it is sent back to the start screen with a notice. The server checks
  the flag on every request, so `admin … off`
  takes effect without signing out. Without sign-in (`HO_AUTH=off`) there are no
  admins.
- Admins can also **invite** players from that panel: “Create invite link” makes a
  one-time link (with an optional note such as “for Max”). The new player opens it,
  picks a user name and a password and is signed in right away – no first password
  to pass on, no password change. Each link works **once** and expires after
  **24 hours**; open invites are listed there and can be revoked. The link is shown
  only when it is created: `invites.json` next to `users.json` holds just a hash of
  it, so reading that file does not reveal a working link.
- In between sits the **inviter** role: a regular player who may also create invite
  links. An admin grants and takes it in the admin panel from the “⋯” action menu of the
  account (“Allow inviting” / “Stop inviting”), or on the host with `inviter`.
  Inviters get an *Invites* section below their friends: create a link, see and
  revoke their own open invites – not anyone else's, and nothing else of the admin
  panel. When the role is taken away (or the account deleted), their open links end
  at once; an open tab learns it without a reload.
- From the same menu an admin can **block** and **delete** an account. A blocked
  account can still sign in, but gets nothing but a dialog saying it is blocked and
  a field to write to the admins – the server refuses everything else, and open
  connections are closed when the block is set (a seat in a game then counts as
  left). The same goes for `block` on the host. Over HTTP only signing in and out
  remain; changing the password works only when a first password has to be
  replaced, and deleting one's own account does not work either – that goes through
  the admins. After five messages in a row the server waits for an answer before
  taking more. Admins read and answer those messages from the menu under *Messages*; they
  are stored as plain text in `appeals.json` next to `users.json`. *Delete user*
  takes two clicks and, like deleting your own account, takes the profile image,
  friendships and messages along. Admins can be neither blocked nor deleted.
- Players pick their in-game **display name** themselves (see
  [Playing › Profile](playing.md#starting-a-game)); `name` only changes the
  spelling of the account name, e.g. for the "Signed in as …" line.

All the host holds per account is the name, a **scrypt hash** of the password
(salted, parameters inside the hash) and, if set, the display name and the version
of the profile picture. No clear text, no mail address, no session keys: those live
in server memory alone and are gone after a restart.

## What the sign-in withstands

- **Guessing is slowed down.** From the fifth failed attempt on it locks, for ever
  longer (30 s, 1 min, 2 min … up to 15 min) – counted per account *and* per origin.
- **The session cookie** is `HttpOnly` and `SameSite=Lax`, behind HTTPS also
  `Secure`. The endpoints accept real JSON only – a form from somebody else's site
  does not get through.
- **An unknown name takes as long as a known one.** The response time does not give
  away which accounts exist.
- **Before the first password change** there is a session, but no game.
- **Without a session** only the sign-in page comes out, plus stylesheet, wordmark
  and language catalogues. Neither `client/js/`, nor `shared/rules.js`, nor profile
  pictures, nor a path with encoded separators (`/css/..%2f..%2f…`) gets around that.
- **Display names** may not match another account; the server strips markup
  characters. **Profile pictures** are checked to be real PNG, JPEG or WebP (64 kB
  at most) and served with `nosniff`.

## Behind a reverse proxy

The server speaks HTTP and knows nothing of TLS – that is the proxy's job. Two
things it must do:

```nginx
location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;      # or no WebSocket is established
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;  # or the cookie loses its Secure flag
    proxy_set_header X-Forwarded-For $remote_addr;
}
```

A sub-path such as `/ho/` works the same way. The trailing slash on `proxy_pass`
matters: it strips `/ho` before the request reaches the server.

```nginx
location = /ho { return 301 /ho/; }
location /ho/ {
    proxy_pass http://127.0.0.1:8080/;
    # … same proxy_set_header lines as above
}
```

The port then belongs to the proxy only, not to the open net:

```
HOST_BIND=127.0.0.1 docker compose up -d
```

## Settings

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8080` | server port |
| `HO_AUTH` | on | `off` switches the sign-in off – for development only |
| `HO_DEV` | off | `on` turns on the dev mode: admins get the debug dialog (Ctrl+Shift+D): test battle, sounds and, in the running game, opening and closing wormholes and a destroyer on the spot; without sign-in everyone gets it – for development only |
| `HO_USERS_FILE` | `data/users.json` | where the accounts live; profile pictures sit next to it in `avatars/` |
| `HO_SESSION_DAYS` | `30` | how long a session is good for |
| `HO_SECURE_COOKIES` | automatic | `1`/`0` forces or forbids the `Secure` flag |
| `HO_IDLE_HOURS` | `4` | a game nobody has made a move in (orders, end of turn, chat …) for this long is discarded, even with a tab still open; with nobody connected after half the time |
| `HO_LANG` | from the environment | language of the `users.js` tool |
| `HOST_PORT`, `HOST_BIND` | `8080`, `0.0.0.0` | Docker only: port and address on the host |

What makes up a game (playing field, turn limit, starting capital …) is set by the
host in the lobby – see [Playing](playing.md#starting-a-game).

## Data

Accounts and profile pictures live in `data/` (inside the container `/data`, bound
from `./data` next to `docker-compose.yml`). They survive every new image; a backup
is a copy of the directory. The account file is mode 0600 and is written beside
itself and then moved into place, so an abort cannot lose the whole set.

**Running games** live in server memory only – a restart ends them, and with them
the open sessions.
