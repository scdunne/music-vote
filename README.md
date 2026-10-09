# Music Vote

A small private site where 5 friends run themed music rounds: everyone submits songs from Spotify, everyone votes, and the host's Spotify account gets a playlist of the results. The full spec is in [docs/design-doc.md](docs/design-doc.md).

It's served unlisted at **https://scdunne.github.io/music-vote/**. Nothing on the main site links to it, and it sets `noindex`. Only allowlisted members can sign in.

```
src/            React app (Vite + TypeScript, HashRouter)
supabase/       schema.sql (tables, RLS, triggers) and rls-checks.sql (acceptance tests)
.github/        GitHub Pages deploy workflow
docs/           design doc
```

## One-time setup

1. **Supabase.** Create a free project, open the SQL editor, and run `supabase/schema.sql`. Then run `supabase/rls-checks.sql`. Every line should print `PASS`, and the script rolls itself back.
2. **Spotify.** In the [Developer Dashboard](https://developer.spotify.com/dashboard), create an app with the Web API enabled. Set its redirect URI to `https://<project-ref>.supabase.co/auth/v1/callback`. Under *User Management*, add each member's name and Spotify account email. The app owner needs Spotify Premium.
3. **Supabase Auth.**
   - Under *Authentication → Providers → Spotify*, enable the provider and paste the Spotify Client ID and Secret.
   - Under *Authentication → URL Configuration*, set the Site URL to `https://scdunne.github.io/music-vote/`.
   - Add `https://scdunne.github.io/music-vote/` and `http://127.0.0.1:5173/music-vote/` to the redirect allow-list.
4. **Members.** In the SQL editor, add the same emails you used in the Spotify dashboard:
   ```sql
   insert into allowed_emails (email) values ('you@…'), ('friend@…');
   ```
5. **GitHub.**
   - Create the public repo `scdunne/music-vote` and push this folder to it.
   - Under *Settings → Secrets and variables → Actions → Variables*, add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Both are public by design, and the publishable key works too.
   - Under *Settings → Pages*, set the source to **GitHub Actions**.
6. **Host.** Log in once on the site, then run:
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

- **Spotify token expiry.** Spotify tokens last about an hour and Supabase can't refresh them, so search and playlist creation may ask you to *Reconnect Spotify*. Reconnecting takes one click.
- **Spotify API version.** The playlist calls use the post-February-2026 endpoints, `POST /me/playlists` and `POST /playlists/{id}/items`.
- **Votes stay private.** During voting you can only read your own votes, even from the API. Everyone's votes become visible when the round closes.
- **Closing a round.** If playlist creation fails after a round closes, the host can retry from the round's page.
