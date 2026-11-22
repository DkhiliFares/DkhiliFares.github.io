// A small, deterministic PDF writer. Uses standard PDF fonts; no external dependency.
// Only approved public data is included, never the original confidential CV file.
export function cvPDF(data){
 const clean=s=>String(s).replace(/[–—]/g,'-').replace(/[’‘]/g,"'").replace(/·/g,'|').replace(/[^\x20-\x7e]/g,'');
 const escape=s=>clean(s).replace(/[\\()]/g,'\\$&');
 const wrap=(s,len=93)=>{const words=clean(s).split(/\s+/);const lines=[];let line='';for(const word of words){if((line+' '+word).length>len){lines.push(line);line=word;}else line+=(line?' ':'')+word;}if(line)lines.push(line);return lines;};
 const pages=[];let stream='',y=798;
 function text(s,size=10,bold=false){for(const line of wrap(s,size>14?48:96)){if(y<55){pages.push(stream);stream='';y=798;}stream+=`BT /${bold?'F2':'F1'} ${size} Tf 0.08 0.15 0.22 rg 46 ${y} Td (${escape(line)}) Tj ET\n`;y-=size*1.30;}}
 function heading(s){y-=10;text(s,13,true);y-=4;}
 text(data.profile.name,25,true);text('Computer Engineer | Tunis, Tunisia',12);text('Contact via portfolio or LinkedIn',10);y-=8;text(data.profile.intro);
 heading('PROFESSIONAL EXPERIENCE');
 for(const x of data.experience){text(`${x.company} | ${x.title}`,11,true);text(x.period,9);for(const t of x.details)text('- '+t);y-=8;}
 heading('EDUCATION');for(const x of data.education){text(x.title,11,true);text(`${x.institution} | ${x.period}`);if(x.major){text('Department: Computer Science | Specialization: Computer Science');text('Major: Computer Engineering');}y-=6;}
 heading('SELECTED SKILLS');text('C / C++, Python, Java; STM32, ARM Cortex-M, HAL and UART; Linux, cross-compilation, Buildroot and QEMU; Raspberry Pi, LoRaWAN and MQTT; FPGA, VHDL and Nios II.');text('Practical and academic evidence is detailed in the portfolio.');
 heading('CREDENTIALS & ACHIEVEMENT');for(const c of data.certifications)text(`${c.title} | ${c.issuer}${c.date?' | '+c.date:''}`);for(const a of data.achievements)text(`${a.title} | ${a.organization} | ${a.date}`);
 heading('LANGUAGES & LINKS');text(data.profile.languages.map(l=>`${l.name}: ${l.level}`).join(' | '));text(data.profile.github);text(data.profile.linkedin);pages.push(stream);
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>'];const kids=[];
 for(const stream of pages){const pageId=objects.length+1,contentId=pageId+1;kids.push(`${pageId} 0 R`);objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`);objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`);}
 objects[1]=`<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages.length} >>`;
 let pdf='%PDF-1.4\n';const offsets=[0];objects.forEach((obj,i)=>{offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${obj}\nendobj\n`;});const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(o=>`${String(o).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;return Buffer.from(pdf);
}
