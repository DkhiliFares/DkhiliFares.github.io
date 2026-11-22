export function initOwner() {
  const root=document.querySelector('[data-owner-portal]');
  if (!root || !root.dataset.supabaseUrl || !root.dataset.publishableKey) return;
  const base=root.dataset.supabaseUrl.replace(/\/$/,'');
  const key=root.dataset.publishableKey;
  const login=document.querySelector('#owner-login');
  const inbox=document.querySelector('#owner-inbox');
  const status=login.querySelector('.owner-status');
  const count=inbox.querySelector('.owner-count');
  const list=inbox.querySelector('.owner-messages');
  let token='';
  const endpoint=`${base}/functions/v1/owner-messages`;
  const api=async(method,body) => {
    const response=await fetch(endpoint,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
    const result=await response.json();
    if(!response.ok)throw new Error(result.error||'Inbox request failed.');
    return result;
  };
  function render(messages) {
    list.replaceChildren();
    count.textContent=`${messages.filter(m=>m.state==='unread').length} unread · ${messages.length} recent messages`;
    if(!messages.length){const empty=document.createElement('p');empty.textContent='No messages yet.';list.append(empty);return;}
    for(const message of messages){
      const article=document.createElement('article');article.className=`owner-message state-${message.state}`;
      const meta=document.createElement('div');meta.className='owner-message-meta';
      const date=document.createElement('time');date.dateTime=message.created_at;date.textContent=new Date(message.created_at).toLocaleString();
      const state=document.createElement('span');state.textContent=message.state;
      meta.append(date,state);
      const title=document.createElement('h3');title.textContent=message.subject;
      const sender=document.createElement('p');sender.className='owner-sender';sender.textContent=message.sender_email;
      const body=document.createElement('p');body.className='owner-message-body';body.textContent=message.body;
      const controls=document.createElement('div');controls.className='owner-message-actions';
      for(const [next,label] of [['read','Mark read'],['archived','Archive']]){
        if(message.state===next)continue;
        const button=document.createElement('button');button.type='button';button.className='button secondary';button.textContent=label;
        button.addEventListener('click',async()=>{button.disabled=true;try{await api('POST',{id:message.id,state:next});await refresh();}catch(error){count.textContent=error.message;}finally{button.disabled=false;}});
        controls.append(button);
      }
      article.append(meta,title,sender,body,controls);list.append(article);
    }
  }
  async function refresh(){const result=await api('GET');render(result.messages);}
  login.addEventListener('submit',async event=>{
    event.preventDefault();if(!login.reportValidity())return;
    const button=login.querySelector('[type="submit"]');button.disabled=true;status.textContent='Opening inbox…';
    try{
      const response=await fetch(`${base}/auth/v1/token?grant_type=password`,{method:'POST',headers:{apikey:key,'Content-Type':'application/json'},body:JSON.stringify({email:login.querySelector('#owner-email').value,password:login.querySelector('#owner-password').value})});
      const result=await response.json();if(!response.ok||!result.access_token)throw new Error('Sign-in failed. Check your account details.');
      token=result.access_token;await refresh();login.hidden=true;inbox.hidden=false;login.reset();status.textContent='';
    }catch(error){token='';status.textContent=error.message;}finally{button.disabled=false;}
  });
  document.querySelector('#owner-signout')?.addEventListener('click',()=>{token='';list.replaceChildren();inbox.hidden=true;login.hidden=false;status.textContent='Signed out.';});
}
