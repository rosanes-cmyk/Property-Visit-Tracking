// Server-side proxy to the Apps Script Web App JSON API. The token lives only on the server.
const URL_ = () => process.env.APPS_SCRIPT_URL;
const TOKEN_ = () => process.env.APPS_SCRIPT_TOKEN;

export async function fetchData() {
  const url = URL_(), token = TOKEN_();
  if (!url || !token) throw new Error('APPS_SCRIPT_URL / APPS_SCRIPT_TOKEN not configured');
  const res = await fetch(url + '?api=data&token=' + encodeURIComponent(token), {
    method: 'GET', redirect: 'follow', cache: 'no-store',
  });
  return res.json();
}

export async function postAction(action, id, params) {
  const url = URL_(), token = TOKEN_();
  if (!url || !token) throw new Error('APPS_SCRIPT_URL / APPS_SCRIPT_TOKEN not configured');
  const res = await fetch(url, {
    method: 'POST', redirect: 'follow', cache: 'no-store',
    // text/plain avoids a CORS preflight; this is a server-to-server call anyway.
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ token, action, id, params: params || {} }),
  });
  return res.json();
}
