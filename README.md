# Music Vote

A small private site where a group of friends runs themed music rounds: everyone submits songs from Spotify, the host's Spotify account gets a playlist of them to listen to, and everyone votes. The full spec is in [docs/design-doc.md](docs/design-doc.md).

It's served unlisted at **https://scdunne.github.io/music-vote/**. Nothing on the main site links to it, and it sets `noindex`. Only allowlisted members can sign in.

```
src/            React app (Vite + TypeScript, HashRouter)
supabase/       schema.sql (tables, RLS, triggers) and rls-checks.sql (acceptance tests)
.github/        GitHub Pages deploy workflow
docs/           design doc
```

## One-time setup

1. **Supabase.** Create a free project, open the SQL editor, and run `supabase/schema.sql`. Then run `supabase/rls-checks.sql`. Every line should print `PASS`, and the script rolls itself back.
2. **Spotify.** In the [Developer Dashboard](https://developer.spotify.com/dashboard), create an app with the Web API enabled. Set its redirect URI to `https://<project-ref>.supabase.co/auth/v1/callback`. Under *User Management*, add **only the host's** name and Spotify account email. The app owner needs Spotify Premium.
3. **Supabase Auth.**
   - Members sign in with an emailed link. Supabase's built-in email sender only delivers to your Supabase team's own addresses and is heavily rate-limited, so set up custom SMTP under *Authentication → Emails → SMTP Settings*. A free [Resend](https://resend.com) account works.
   - Under *Authentication → Sign In / Providers*, turn on **Allow manual linking**. The host links Spotify to their email account the first time they create a playlist.
   - Under *Authentication → Providers → Spotify*, enable the provider and paste the Spotify Client ID and Secret.
   - Under *Authentication → URL Configuration*, set the Site URL to `https://scdunne.github.io/music-vote/`.
   - Add `https://scdunne.github.io/music-vote/` and `http://127.0.0.1:5173/music-vote/` to the redirect allow-list.
4. **Search function.** With the [Supabase CLI](https://supabase.com/docs/guides/cli), deploy the edge function that searches Spotify for members:
   ```sh
   supabase link --project-ref <project-ref>
   supabase secrets set SPOTIFY_CLIENT_ID=… SPOTIFY_CLIENT_SECRET=…
   supabase functions deploy spotify-search
   ```
5. **Members.** In the SQL editor, add each member's email. These are the addresses they'll log in with, and they don't need to be Spotify emails:
   ```sql
   insert into allowed_emails (email) values ('you@…'), ('friend@…');
   ```
6. **GitHub.**
   - Create the public repo `scdunne/music-vote` and push this folder to it.
   - Under *Settings → Secrets and variables → Actions → Variables*, add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Both are public by design, and the publishable key works too.
   - Under *Settings → Pages*, set the source to **GitHub Actions**.
7. **Host.** Log in once on the site, then run:
   ```sql
   update profiles set is_host = true
     where id = (select id from auth.users where email = 'you@…');
   ```

## Local development

```sh
cp .env.example .env.local   # fill in the two values
npm install
npm run dev                  # http://127.0.0.1:5173/music-vote/
```

## Notes

- **Why members don't use Spotify login.** Spotify's development mode caps an app at 5 authorized users. Only the host authorizes with Spotify, to create playlists. Members search through the `spotify-search` edge function, which uses the app's own Client Credentials token, so any number of members can join.
- **Spotify token expiry.** The host's Spotify token lasts about an hour and Supabase can't refresh it, so creating a playlist may ask the host to *Connect Spotify*. Connecting takes one click. Search uses the app token and never asks.
- **Spotify API version.** The playlist calls use the post-February-2026 endpoints, `POST /me/playlists` and `POST /playlists/{id}/items`.
- **Votes stay private.** During voting you can only read your own votes, even from the API. Everyone's votes become visible when the round closes.
- **Starting voting.** *Start voting* also creates the round's playlist. If that step fails, the host can retry from the round's page.
- **Upgrading an existing database.** Run the files in `supabase/migrations/` in order. Each one is safe to run once.
