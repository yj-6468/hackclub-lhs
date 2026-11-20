const {test}=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const fs=require('node:fs');
test('image paste, web toggle, failed-send recovery and new chat work without welcome elements',async()=>{
  const {window:w}=new JSDOM(fs.readFileSync('clubhelper/index.html','utf8'),{url:'https://club.example/clubhelper/',runScripts:'outside-only'});
  w.TextEncoder=TextEncoder; w.AbortSignal=AbortSignal;
  w.HTMLElement.prototype.scrollIntoView=()=>{};
  w.createImageBitmap=async()=>({width:20,height:20,close(){}});
  w.HTMLCanvasElement.prototype.getContext=()=>({fillRect(){},drawImage(){}});
  w.HTMLCanvasElement.prototype.toDataURL=()=> 'data:image/jpeg;base64,/9j/AAAA';
  let sent; let fail=true;
  w.fetch=async(_,init)=>{
    if(init.method==='GET') return Response.json({userId:'tester',allowedModels:['sonnet','haiku']});
    sent=JSON.parse(init.body);
    return fail ? Response.json({error:'Try again'},{status:502}) : Response.json({reply:'x'.repeat(80000),sources:[{url:'https://example.com',title:'Example'}]});
  };
  w.eval(fs.readFileSync('clubhelper/chat.js','utf8'));
  const el=id=>w.document.getElementById(id);
  const tick=()=>new Promise(resolve=>setTimeout(resolve,10));
  el('user-id').value='tester'; el('password').value='test-password'; el('access-form').dispatchEvent(new w.Event('submit',{cancelable:true})); await tick();
  assert.equal(el('conversation').hidden,false);
  assert.deepEqual(Array.from(el('chat-model').options, option => option.value), ['sonnet', 'haiku']);
  assert.equal(el('chat-model').value,'haiku');
  el('chat-model').value='sonnet';
  const paste=new w.Event('paste',{cancelable:true}); Object.defineProperty(paste,'clipboardData',{value:{files:[{type:'image/png',size:10}]}});
  el('message').dispatchEvent(paste); await tick();
  assert.equal(el('attachments').querySelectorAll('img').length,1);
  el('use-web').click(); el('chat-form').dispatchEvent(new w.Event('submit',{cancelable:true})); await tick();
  assert.equal(sent.web,true); assert.equal(sent.messages[0].images.length,1);
  assert.equal(sent.model,'sonnet');
  assert.equal(el('attachments').querySelectorAll('img').length,1);
  fail=false; el('chat-form').dispatchEvent(new w.Event('submit',{cancelable:true})); await tick();
  assert.equal(el('attachments').children.length,0); assert.equal(w.document.querySelectorAll('.sent-images img').length,1);
  assert.equal(w.document.querySelector('.sources a').href,'https://example.com/');
  el('message').value='Continue.'; el('chat-form').dispatchEvent(new w.Event('submit',{cancelable:true})); await tick();
  assert.equal(sent.messages.length,3); assert.equal(sent.messages[1].content.length,80000);
  el('message').value='And then?'; el('chat-form').dispatchEvent(new w.Event('submit',{cancelable:true})); await tick();
  assert.equal(sent.messages.length,3); assert.equal(sent.messages[0].content,'Continue.');
  el('new-chat').click(); assert.equal(el('messages').children.length,0);
  el('lock-chat').click(); assert.equal(el('conversation').hidden,true);
  w.close();
});

test('uploads a PDF, copies the reply, and replaces a conversation branch only after a successful resend', async () => {
  const { window: w } = new JSDOM(fs.readFileSync('clubhelper/index.html', 'utf8'), {
    url: 'https://club.example/clubhelper/', runScripts: 'outside-only'
  });
  try {
    w.TextEncoder = TextEncoder;
    w.AbortSignal = AbortSignal;
    w.HTMLElement.prototype.scrollIntoView = () => {};
    const doc = w.document;
    const el = id => doc.getElementById(id);
    const tick = () => new Promise(resolve => setTimeout(resolve, 15));
    const submit = async form => {
      el(form).dispatchEvent(new w.Event('submit', { cancelable: true }));
      await tick();
    };
    let sent;
    let copied;
    let fail = false;
    Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: async text => { copied = text; } } });
    w.fetch = async (_, init) => {
      if (init.method === 'GET') return Response.json({ userId: 'tester', allowedModels: ['sonnet', 'haiku'] });
      sent = JSON.parse(init.body);
      return fail ? Response.json({ error: 'Try again' }, { status: 502 })
        : Response.json({ reply: '**Reply** to ' + sent.messages.at(-1).content });
    };
    w.eval(fs.readFileSync('clubhelper/chat.js', 'utf8'));
    el('user-id').value = 'tester';
    el('password').value = 'test-password';
    await submit('access-form');

    const pdfSource = '%PDF-1.7\n%%EOF';
    const pdf = new w.File([pdfSource], 'club-notes.pdf', { type: 'application/pdf' });
    Object.defineProperty(el('pdf-file'), 'files', { value: [pdf] });
    el('pdf-file').dispatchEvent(new w.Event('change'));
    await tick();
    assert.match(el('attachments').textContent, /club-notes\.pdf/);
    await submit('chat-form');
    assert.equal(sent.messages[0].pdf, Buffer.from(pdfSource).toString('base64'));
    assert.equal(sent.messages[0].content, 'Summarize this PDF.');
    assert.equal(doc.querySelector('.message .pdf-chip').textContent, 'club-notes.pdf');
    doc.querySelector('.assistant .message-action').click();
    await tick();
    assert.equal(copied, '**Reply** to Summarize this PDF.');

    el('message').value = 'A follow-up';
    await submit('chat-form');
    assert.equal(el('messages').children.length, 4);
    el('message').value = 'Unsent draft';
    doc.querySelector('.edit-message').click();
    assert.equal(el('edit-banner').hidden, false);
    assert.equal(el('send-icon').hasAttribute('hidden'), true);
    assert.equal(el('message').value, '');
    assert.match(el('attachments').textContent, /club-notes\.pdf/);
    el('cancel-edit').click();
    assert.equal(el('message').value, 'Unsent draft');

    doc.querySelector('.edit-message').click();
    el('message').value = 'Extract the dates instead';
    fail = true;
    await submit('chat-form');
    assert.equal(el('messages').children.length, 4);
    assert.equal(el('message').value, 'Extract the dates instead');
    assert.equal(el('edit-banner').hidden, false);
    assert.match(el('attachments').textContent, /club-notes\.pdf/);
    fail = false;
    await submit('chat-form');
    assert.equal(sent.messages.length, 1);
    assert.equal(sent.messages[0].pdf, Buffer.from(pdfSource).toString('base64'));
    assert.equal(el('messages').children.length, 2);
    assert.equal(doc.querySelector('.user .message-body').textContent, 'Extract the dates instead');
    assert.equal(el('message').value, 'Unsent draft');
    assert.equal(el('edit-banner').hidden, true);
    assert.equal(el('send-icon').hasAttribute('hidden'), false);
  } finally {
    w.close();
  }
});
