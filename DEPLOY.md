# Deploy mehk3y.com

This site is plain static HTML/CSS/JS. You can deploy it anywhere that supports static hosting.

## Recommended: Cloudflare Pages

1. Create a Cloudflare Pages project.
2. Upload these files from this folder:
   - `index.html`
   - `styles.css`
   - `script.js`
3. Add the custom domain:
   - `mehk3y.com`
   - `www.mehk3y.com`
4. In DNS, use the records Cloudflare gives you.

Typical DNS setup:

```text
Type   Name   Target
CNAME  www    your-project.pages.dev
CNAME  @      your-project.pages.dev
```

If your DNS provider does not support `CNAME` at root, use Cloudflare DNS or the `A` records your host provides.

## Alternative: Vercel

1. Create a new Vercel project from this folder.
2. Framework preset: Other.
3. Build command: leave empty.
4. Output directory: leave empty or use `./`.
5. Add `mehk3y.com` and `www.mehk3y.com` in Project Settings > Domains.
6. Add the DNS records Vercel shows you.

## Local preview

```bash
python3 -m http.server 8080
```

Then open:

```text
http://localhost:8080/
```
