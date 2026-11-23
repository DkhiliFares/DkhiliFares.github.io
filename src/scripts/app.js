import { initNavigation } from './navigation.js';
import { initArchive } from './filters.js';
import { initSkills } from './skills.js';
import { startField } from './magnetic-engine.js';
import { initContact } from './contact.js';
document.documentElement.classList.add('js');
initNavigation();initArchive();initSkills();initContact();
const canvas=document.querySelector('.field-canvas');if(canvas)startField(canvas);
document.querySelector('[data-print-cv]')?.addEventListener('click',()=>window.print());
