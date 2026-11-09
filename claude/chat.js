(() => {
  const byId = (id) => document.getElementById(id);
  const accessForm = byId('access-form');
  const chatForm = byId('chat-form');
  const messageInput = byId('message');
  const messages = byId('messages');
  let authorization = '';
  let signedInId = '';
  let history = [];
  let busy = false;

  async function api(method, body, credentials = authorization) {
    const response = await fetch('/api/claude', {
      method,
      headers: { Authorization: credentials, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(55000),
      cache: 'no-store'
    });
    let result;
    try { result = await response.json(); }
    catch { throw new Error('The chat server is unavailable. Please contact a club leader.'); }
    if (!response.ok) {
      const error = new Error(result.error || 'Something went wrong. Please try again.');
      error.status = response.status;
      throw error;
    }
    return result;
  }

  function addMessage(role, content) {
    const article = document.createElement('article');
    article.className = `message ${role}`;
    const label = document.createElement('h3');
    label.className = 'message-label';
    label.textContent = role === 'user' ? 'You' : 'Claude';
    const text = document.createElement('p');
    text.className = 'message-body';
    // Render both user input and model output as text, never executable HTML.
    text.textContent = content;
    article.append(label, text);
    messages.append(article);
    messages.scrollTop = messages.scrollHeight;
    return article;
  }

  function setBusy(value) {
    busy = value;
    byId('send').disabled = value;
    byId('new-chat').disabled = value;
    byId('lock-chat').disabled = value;
    messageInput.disabled = value;
    byId('send').textContent = value ? 'Thinking…' : 'Send ↑';
    byId('connection-status').textContent = value ? 'Claude is thinking…' : `Signed in as ${signedInId}`;
  }

  function clearChat() {
    history = [];
    messages.querySelectorAll('.message').forEach((element) => element.remove());
    byId('welcome').hidden = false;
    byId('chat-status').textContent = '';
    messageInput.value = '';
    messageInput.focus();
  }

  function lock() {
    clearChat();
    authorization = '';
    signedInId = '';
    byId('user-id').value = '';
    byId('password').value = '';
    byId('access-panel').hidden = false;
    byId('conversation').hidden = true;
    byId('lock-chat').hidden = true;
    byId('new-chat').disabled = true;
    byId('connection-status').textContent = 'Signed out';
    byId('user-id').focus();
  }

  accessForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const id = byId('user-id').value.trim();
    const password = byId('password').value;
    // UTF-8 supports passwords containing non-ASCII characters and colons.
    const credentials = `Basic ${btoa(String.fromCharCode(...new TextEncoder().encode(`${id}:${password}`)))}`;
    byId('unlock').disabled = true;
    byId('access-status').textContent = 'Signing in…';
    try {
      const result = await api('GET', undefined, credentials);
      authorization = credentials;
      signedInId = result.userId;
      byId('password').value = '';
      byId('access-panel').hidden = true;
      byId('conversation').hidden = false;
      byId('lock-chat').hidden = false;
      byId('access-status').textContent = '';
      setBusy(false);
      messageInput.focus();
    } catch (error) {
      byId('access-status').textContent = error.name === 'TimeoutError' ? 'The connection timed out. Please try again.' : error.message;
    } finally { byId('unlock').disabled = false; }
  });

  chatForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const content = messageInput.value.trim();
    if (!content || busy || !authorization) return;
    // Keep whole pairs and bound both the message count and history size.
    const recent = history.slice(-20);
    while (recent.length && recent.reduce((total, message) => total + message.content.length, content.length) > 24000) recent.splice(0, 2);
    const pending = [...recent, { role: 'user', content }];
    byId('welcome').hidden = true;
    const userMessage = addMessage('user', content);
    messageInput.value = '';
    byId('chat-status').textContent = 'Claude is thinking…';
    setBusy(true);
    let shouldLock = false;
    try {
      const result = await api('POST', { messages: pending });
      if (typeof result.reply !== 'string' || !result.reply.trim()) throw new Error('Claude returned no text. Please try again.');
      history = [...pending, { role: 'assistant', content: result.reply }];
      addMessage('assistant', result.reply);
      byId('chat-status').textContent = result.truncated ? 'Reply reached the length limit. Ask Claude to continue.' : '';
    } catch (error) {
      userMessage.remove();
      messageInput.value = content;
      byId('welcome').hidden = history.length > 0;
      byId('chat-status').textContent = error.name === 'TimeoutError' ? 'The request timed out. Your message is ready to try again.' : error.message;
      shouldLock = error.status === 401;
    } finally {
      setBusy(false);
      if (shouldLock) {
        lock();
        byId('access-status').textContent = 'Your sign-in is no longer valid. Please sign in again.';
      } else { messageInput.focus(); }
    }
  });

  messageInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && !busy) {
      event.preventDefault();
      chatForm.requestSubmit();
    }
  });
  document.querySelectorAll('[data-prompt]').forEach((button) => button.addEventListener('click', () => {
    messageInput.value = button.dataset.prompt;
    messageInput.focus();
  }));
  byId('new-chat').addEventListener('click', clearChat);
  byId('lock-chat').addEventListener('click', lock);

  // Enable credentials only after the submit handler exists and HTTP can serve the API.
  // If scripts fail to load, the form stays disabled instead of submitting a password in a URL.
  if (['http:', 'https:'].includes(window.location.protocol)) {
    byId('login-fields').disabled = false;
    byId('access-status').textContent = '';
  } else {
    byId('access-status').textContent = 'Open this page through the website or local server to sign in.';
  }
})();
