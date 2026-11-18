(() => {
  const byId = (id) => document.getElementById(id);
  const accessForm = byId('access-form');
  const chatForm = byId('chat-form');
  const messageInput = byId('message');
  const messages = byId('messages');
  const modelPicker = byId('chat-model');
  const modelLabels = { sonnet: 'Sonnet', haiku: 'Haiku', opus: 'Opus' };
  const MAX_ATTACHMENT_CHARS = 3_100_000;
  const PDF_TYPE = 'application/pdf';
  let authorization = '';
  let signedInId = '';
  let history = [];
  let busy = false;
  let attachments = [];
  let preparingFiles = false;
  let editing = null;
  let web = false;

  function attachmentPreview(file, container) {
    if (file.media_type === PDF_TYPE) {
      const chip = document.createElement('span');
      chip.className = 'pdf-chip';
      chip.textContent = file.name;
      container.append(chip);
      return;
    }
    const preview = document.createElement('img');
    preview.src = `data:${file.media_type};base64,${file.data}`;
    preview.alt = 'Attached image';
    container.append(preview);
  }
  function renderAttachments() {
    const container = byId('attachments');
    container.replaceChildren();
    attachments.forEach((file, index) => {
      const item = document.createElement('div');
      attachmentPreview(file, item);
      const remove = document.createElement('button');
      remove.type = 'button'; remove.textContent = '×';
      remove.setAttribute('aria-label', file.media_type === PDF_TYPE ? 'Remove PDF' : `Remove image ${index + 1}`);
      remove.disabled = busy || preparingFiles;
      remove.addEventListener('click', () => { attachments.splice(index, 1); renderAttachments(); });
      item.append(remove); container.append(item);
    });
  }

  function readPDF(file) {
    if (file.size > 2_000_000) throw new Error('Choose a PDF up to 2 MB.');
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('This PDF could not be read.'));
      reader.onload = () => {
        const data = reader.result.split(',')[1];
        if (!data || !atob(data.slice(0, 8)).startsWith('%PDF-')) {
          reject(new Error('Choose a valid PDF file.'));
          return;
        }
        resolve({ media_type: PDF_TYPE, data, name: file.name || 'PDF attachment' });
      };
      reader.readAsDataURL(file);
    });
  }

  async function readImage(file) {
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type) || file.size > 10_000_000) {
      throw new Error('Choose a PNG, JPEG, WebP, or GIF image under 10 MB.');
    }
    const bitmap = await createImageBitmap(file);
    try {
      const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext('2d');
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      for (const quality of [.85, .65, .45]) {
        const data = canvas.toDataURL('image/jpeg', quality).split(',')[1];
        if (data.length <= 700000) return { media_type: 'image/jpeg', data };
      }
      throw new Error('This image is too detailed. Try a smaller image.');
    } finally { bitmap.close(); }
  }

  async function attachFiles(files) {
    if (!files.length || busy || preparingFiles || !authorization) return;
    preparingFiles = true;
    updateComposer();
    byId('chat-status').textContent = 'Preparing attachments…';
    try {
      for (const file of files) {
        const isPDF = file.type === PDF_TYPE || (!file.type && /\.pdf$/i.test(file.name));
        if (isPDF && attachments.some(file => file.media_type === PDF_TYPE)) throw new Error('Attach one PDF per message.');
        if (!isPDF && attachments.filter(file => file.media_type !== PDF_TYPE).length >= 3) throw new Error('Attach up to 3 images per message.');
        const attachment = await (isPDF ? readPDF(file) : readImage(file));
        const size = attachments.reduce((total, file) => total + file.data.length, attachment.data.length);
        if (size > MAX_ATTACHMENT_CHARS) throw new Error('These attachments are too large together. Remove a file or send it separately.');
        attachments.push(attachment);
      }
      byId('chat-status').textContent = '';
    } catch (error) { byId('chat-status').textContent = error.message || 'This attachment could not be read.'; }
    finally {
      preparingFiles = false;
      byId('image-files').value = '';
      byId('pdf-file').value = '';
      updateComposer();
    }
  }
  for (const [button, input] of [['attach-image', 'image-files'], ['attach-pdf', 'pdf-file']]) {
    byId(button).addEventListener('click', () => byId(input).click());
    byId(input).addEventListener('change', event => attachFiles(Array.from(event.target.files)));
  }
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
      signal: AbortSignal.timeout(method === 'POST' ? 235000 : 55000),
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

  function addMessage(role, content, files = [], sources = []) {
    const article = document.createElement('article');
    article.className = `message ${role}`;
    const header = document.createElement('div');
    header.className = 'message-header';
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
    header.append(label);
    article.append(header, text);
    if (files.length) {
      const gallery = document.createElement('div'); gallery.className = 'sent-images';
      files.forEach(file => attachmentPreview(file, gallery)); article.append(gallery);
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
    if (role === 'assistant') {
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'quiet-button message-action';
      copy.textContent = 'Copy reply';
      let resetTimer;
      copy.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(content);
          copy.textContent = 'Copied';
          byId('copy-status').textContent = 'Reply copied.';
        } catch {
          copy.textContent = 'Copy failed';
          byId('copy-status').textContent = 'Could not copy the reply.';
        }
        clearTimeout(resetTimer);
        resetTimer = setTimeout(() => { copy.textContent = 'Copy reply'; }, 1800);
      });
      header.append(copy);
    }
    messages.append(article);
    if (role === 'assistant') article.scrollIntoView({ block: 'start' });
    else messages.scrollTop = messages.scrollHeight;
    return article;
  }

  function updateComposer() {
    const blocked = busy || preparingFiles;
    for (const id of ['attach-image', 'attach-pdf', 'send', 'new-chat', 'lock-chat', 'cancel-edit']) {
      byId(id).disabled = blocked;
    }
    byId('use-web').disabled = busy;
    modelPicker.disabled = busy;
    messageInput.disabled = busy;
    byId('edit-banner').hidden = !editing;
    byId('send-icon').toggleAttribute('hidden', !!editing);
    byId('resend-label').hidden = !editing;
    byId('send').classList.toggle('resend-button', !!editing);
    byId('send').setAttribute('aria-label', busy ? 'Waiting for reply' : editing ? 'Resend message' : 'Send message');
    for (const button of messages.querySelectorAll('.edit-message')) button.disabled = blocked || !!editing;
    renderAttachments();
  }

  function addEditAction(article, index, content, files) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'quiet-button message-action edit-message';
    button.textContent = 'Edit';
    button.setAttribute('aria-label', 'Edit and resend message');
    button.addEventListener('click', () => {
      if (busy || preparingFiles || editing) return;
      editing = { index, draft: messageInput.value, draftFiles: attachments, button };
      messageInput.value = content;
      attachments = files.slice();
      byId('chat-status').textContent = '';
      updateComposer();
      messageInput.focus();
    });
    article.querySelector('.message-header').append(button);
  }

  function finishEdit() {
    const previous = editing;
    editing = null;
    messageInput.value = previous.draft;
    attachments = previous.draftFiles;
    updateComposer();
  }

  byId('cancel-edit').addEventListener('click', () => {
    if (!editing || busy || preparingFiles) return;
    const button = editing.button;
    finishEdit();
    byId('chat-status').textContent = '';
    button.focus();
  });

  function setBusy(value) {
    busy = value;
    updateComposer();
    byId('connection-status').textContent = `Signed in as ${signedInId}`;
  }

  function clearChat() {
    history = [];
    editing = null;
    messages.replaceChildren();
    attachments = [];
    updateComposer();
    byId('chat-status').textContent = '';
    byId('copy-status').textContent = '';
    messageInput.value = '';
    messageInput.focus();
  }

  function lock() {
    clearChat();
    authorization = '';
    signedInId = '';
    modelPicker.replaceChildren(new Option('Sonnet', 'sonnet'));
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
      const allowedModels = Array.isArray(result.allowedModels) ? result.allowedModels : ['sonnet'];
      modelPicker.replaceChildren(...allowedModels.filter(model => Object.hasOwn(modelLabels, model))
        .map(model => new Option(modelLabels[model], model)));
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
    if (busy || preparingFiles || !authorization) return;
    const draft = messageInput.value;
    const sentFiles = attachments.slice();
    const pdf = sentFiles.find(file => file.media_type === PDF_TYPE)?.data;
    const images = sentFiles.filter(file => file.media_type !== PDF_TYPE);
    const content = draft.trim() || (pdf ? 'Summarize this PDF.' : images.length ? 'Describe the attached images.' : '');
    if (!content) return;
    const index = editing ? editing.index : history.length;
    const prior = history.slice(0, index);
    const nextMessage = { role: 'user', content };
    if (images.length) nextMessage.images = images;
    if (pdf) nextMessage.pdf = pdf;
    const pending = [...prior.slice(-20), nextMessage];
    while (pending.length > 1 && exceedsContextLimits(pending)) pending.splice(0, 2);
    let userMessage = editing ? null : addMessage('user', content, sentFiles);
    attachments = [];
    messageInput.value = '';
    byId('chat-status').textContent = 'Thinking…';
    setBusy(true);
    let shouldLock = false;
    try {
      const result = await api('POST', { messages: pending, web, model: modelPicker.value });
      if (typeof result.reply !== 'string' || !result.reply.trim()) throw new Error('Claude returned no text. Please try again.');
      if (editing) {
        for (const element of Array.from(messages.children).slice(index)) element.remove();
        userMessage = addMessage('user', content, sentFiles);
        finishEdit();
      }
      history = [...prior, nextMessage, { role: 'assistant', content: result.reply }];
      addEditAction(userMessage, index, draft.trim(), sentFiles);
      addMessage('assistant', result.reply, [], result.sources || []);
      byId('chat-status').textContent = result.truncated ? 'Reply reached the length limit. Ask me to continue.' : (result.warning || '');
    } catch (error) {
      userMessage?.remove();
      messageInput.value = draft;
      attachments = sentFiles;
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

  function exceedsContextLimits(list) {
    let textLength = 0;
    let attachmentSize = 0;
    let imageCount = 0;
    let pdfCount = 0;
    for (const message of list) {
      textLength += message.content.length;
      for (const image of message.images || []) {
        imageCount++;
        attachmentSize += image.data.length;
      }
      if (message.pdf) {
        pdfCount++;
        attachmentSize += message.pdf.length;
      }
    }
    return textLength > 120000 || attachmentSize > MAX_ATTACHMENT_CHARS || imageCount > 6 || pdfCount > 3;
  }

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
