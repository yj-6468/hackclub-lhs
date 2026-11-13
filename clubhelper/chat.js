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
  let attachments = [];
  let preparingImages = false;
  let web = false;

  function imagePreview(image, container) {
    const preview = document.createElement('img');
    preview.src = `data:${image.media_type};base64,${image.data}`;
    preview.alt = 'Attached image';
    container.append(preview);
  }
  function renderAttachments() {
    const container = byId('attachments');
    container.replaceChildren();
    attachments.forEach((image, index) => {
      const item = document.createElement('div');
      imagePreview(image, item);
      const remove = document.createElement('button');
      remove.type = 'button'; remove.textContent = '×';
      remove.setAttribute('aria-label', `Remove image ${index + 1}`);
      remove.disabled = busy || preparingImages;
      remove.addEventListener('click', () => { attachments.splice(index, 1); renderAttachments(); });
      item.append(remove); container.append(item);
    });
  }
  async function attachFiles(files) {
    if (busy || preparingImages || !authorization) return;
    preparingImages = true;
    byId('send').disabled = true;
    byId('new-chat').disabled = true;
    byId('lock-chat').disabled = true;
    byId('chat-status').textContent = 'Preparing images…';
    renderAttachments();
    try {
      for (const file of files) {
        if (attachments.length >= 3) throw new Error('Attach up to 3 images per message.');
        if (!['image/png','image/jpeg','image/webp','image/gif'].includes(file.type) || file.size > 10000000)
          throw new Error('Choose a PNG, JPEG, WebP, or GIF image under 10 MB.');
        const bitmap = await createImageBitmap(file);
        try {
          const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(bitmap.width * scale));
          canvas.height = Math.max(1, Math.round(bitmap.height * scale));
          const context = canvas.getContext('2d');
          context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
          context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
          let data;
          for (const quality of [.85, .65, .45]) {
            data = canvas.toDataURL('image/jpeg', quality).split(',')[1];
            if (data.length <= 700000) break;
          }
          if (data.length > 700000) throw new Error('This image is too detailed. Try a smaller image.');
          attachments.push({media_type: 'image/jpeg', data});
        } finally { bitmap.close(); }
      }
      byId('chat-status').textContent = '';
    } catch (error) { byId('chat-status').textContent = error.message || 'This image could not be read.'; }
    finally {
      preparingImages = false;
      byId('image-files').value = '';
      setBusy(false); renderAttachments();
    }
  }
  byId('attach-image').addEventListener('click', () => byId('image-files').click());
  byId('image-files').addEventListener('change', event => attachFiles(Array.from(event.target.files)));
  messageInput.addEventListener('paste', event => {
    const files = Array.from(event.clipboardData?.files || []);
    if (files.length) { event.preventDefault(); attachFiles(files); }
  });
  byId('use-web').addEventListener('click', () => {
    web = !web;
    byId('use-web').setAttribute('aria-pressed', String(web));
  });

  async function api(method, body, credentials = authorization) {
    const response = await fetch('/api/clubhelper', {
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

  function addMessage(role, content, images = [], sources = []) {
    const article = document.createElement('article');
    article.className = `message ${role}`;
    const label = document.createElement('h3');
    label.className = 'message-label';
    label.textContent = role === 'user' ? 'You' : 'Club helper';
    const text = document.createElement(role === 'assistant' ? 'div' : 'p');
    text.className = 'message-body';
    if (role === 'assistant' && window.ChatMarkdown) {
      window.ChatMarkdown.render(text, content);
    } else {
      text.textContent = content;
    }
    article.append(label, text);
    if (images.length) {
      const gallery = document.createElement('div'); gallery.className = 'sent-images';
      images.forEach(image => imagePreview(image, gallery)); article.append(gallery);
    }
    if (sources.length) {
      const links = document.createElement('div'); links.className = 'sources';
      links.append(document.createTextNode('Sources: '));
      for (const source of sources) {
        if (!/^https?:\/\//i.test(source.url)) continue;
        const link = document.createElement('a'); link.href = source.url;
        link.textContent = source.title || source.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
        links.append(link);
      }
      article.append(links);
    }
    messages.append(article);
    if (role === 'assistant') article.scrollIntoView({ block: 'start' });
    else messages.scrollTop = messages.scrollHeight;
    return article;
  }

  function setBusy(value) {
    busy = value;
    byId('attach-image').disabled = value;
    byId('use-web').disabled = value;
    renderAttachments();
    byId('send').disabled = value;
    byId('new-chat').disabled = value;
    byId('lock-chat').disabled = value;
    messageInput.disabled = value;
    byId('send').setAttribute('aria-label', value ? 'Waiting for reply' : 'Send message');
    byId('connection-status').textContent = `Signed in as ${signedInId}`;
  }

  function clearChat() {
    history = [];
    messages.querySelectorAll('.message').forEach((element) => element.remove());
    attachments = []; renderAttachments();
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
    const content = messageInput.value.trim() || (attachments.length ? 'Describe this image.' : '');
    if (!content || busy || preparingImages || !authorization) return;
    const sentImages = attachments.slice();
    // Keep whole pairs and bound both the message count and history size.
    const recent = history.slice(-20);
    while (recent.length && recent.reduce((total, message) => total + message.content.length, content.length) > 24000) recent.splice(0, 2);
    const nextMessage = {role: 'user', content, ...(sentImages.length ? {images: sentImages} : {})};
    const imageSize = list => list.reduce((sum, message) => sum + (message.images || []).reduce((n, image) => n + image.data.length, 0), 0);
    const imageCount = list => list.reduce((sum, message) => sum + (message.images?.length || 0), 0);
    while (recent.length && (imageSize([...recent, nextMessage]) > 2500000 || imageCount([...recent, nextMessage]) > 6)) recent.splice(0, 2);
    const pending = [...recent, nextMessage];
    const userMessage = addMessage('user', content, sentImages);
    attachments = []; renderAttachments();
    messageInput.value = '';
    byId('chat-status').textContent = 'Thinking…';
    setBusy(true);
    let shouldLock = false;
    try {
      const result = await api('POST', { messages: pending, web });
      if (typeof result.reply !== 'string' || !result.reply.trim()) throw new Error('Claude returned no text. Please try again.');
      history = [...pending, { role: 'assistant', content: result.reply }];
      addMessage('assistant', result.reply, [], result.sources || []);
      byId('chat-status').textContent = result.truncated ? 'Reply reached the length limit. Ask me to continue.' : (result.warning || '');
    } catch (error) {
      userMessage.remove();
      messageInput.value = content;
      attachments = sentImages; renderAttachments();
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
