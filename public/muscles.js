/* Rituel — carte musculaire. Silhouette stylisée face / dos, régions nommées comme dans les fiches de démonstration
   (chest, lats, quadriceps…). muscleMap(primary[], secondary[]) renvoie le SVG avec les régions mises en évidence. */
(function(){
  const MUSCLE_FR={abdominals:'abdominaux',abductors:'abducteurs',adductors:'adducteurs',biceps:'biceps',calves:'mollets',chest:'pectoraux',forearms:'avant-bras',glutes:'fessiers',hamstrings:'ischio-jambiers',lats:'grand dorsal',"lower back":'lombaires',"middle back":'milieu du dos',neck:'cou',quadriceps:'quadriceps',shoulders:'épaules',traps:'trapèzes',triceps:'triceps'};
  // Chaque région : [vue, forme]. Les formes sont symétrisées (x et 100-x) quand sym=true.
  const R={
    front:[
      ['neck','<rect x="44" y="26" width="12" height="9" rx="4"/>'],
      ['shoulders','<ellipse cx="32" cy="43" rx="8" ry="6"/><ellipse cx="68" cy="43" rx="8" ry="6"/>'],
      ['chest','<path d="M38 40 Q50 36 62 40 L63 56 Q50 62 37 56 Z"/>'],
      ['biceps','<ellipse cx="28" cy="60" rx="5" ry="10"/><ellipse cx="72" cy="60" rx="5" ry="10"/>'],
      ['forearms','<ellipse cx="24" cy="80" rx="4.5" ry="11"/><ellipse cx="76" cy="80" rx="4.5" ry="11"/>'],
      ['abdominals','<rect x="42" y="58" width="16" height="26" rx="5"/>'],
      ['abductors','<ellipse cx="36" cy="94" rx="4" ry="8"/><ellipse cx="64" cy="94" rx="4" ry="8"/>'],
      ['adductors','<ellipse cx="45" cy="100" rx="3.5" ry="9"/><ellipse cx="55" cy="100" rx="3.5" ry="9"/>'],
      ['quadriceps','<ellipse cx="40" cy="118" rx="7" ry="18"/><ellipse cx="60" cy="118" rx="7" ry="18"/>'],
      ['calves','<ellipse cx="40" cy="156" rx="4.5" ry="12"/><ellipse cx="60" cy="156" rx="4.5" ry="12"/>']
    ],
    back:[
      ['neck','<rect x="44" y="26" width="12" height="9" rx="4"/>'],
      ['traps','<path d="M36 38 L50 32 L64 38 L58 54 L50 50 L42 54 Z"/>'],
      ['shoulders','<ellipse cx="32" cy="43" rx="8" ry="6"/><ellipse cx="68" cy="43" rx="8" ry="6"/>'],
      ['triceps','<ellipse cx="28" cy="60" rx="5" ry="10"/><ellipse cx="72" cy="60" rx="5" ry="10"/>'],
      ['forearms','<ellipse cx="24" cy="80" rx="4.5" ry="11"/><ellipse cx="76" cy="80" rx="4.5" ry="11"/>'],
      ['lats','<path d="M36 50 L44 56 L44 74 L40 80 Z"/><path d="M64 50 L56 56 L56 74 L60 80 Z"/>'],
      ['middle back','<rect x="44" y="52" width="12" height="18" rx="4"/>'],
      ['lower back','<rect x="43" y="72" width="14" height="12" rx="4"/>'],
      ['glutes','<ellipse cx="42" cy="94" rx="8" ry="8"/><ellipse cx="58" cy="94" rx="8" ry="8"/>'],
      ['hamstrings','<ellipse cx="40" cy="120" rx="6.5" ry="17"/><ellipse cx="60" cy="120" rx="6.5" ry="17"/>'],
      ['calves','<ellipse cx="40" cy="156" rx="5" ry="13"/><ellipse cx="60" cy="156" rx="5" ry="13"/>']
    ]
  };
  const BODY='<circle cx="50" cy="14" r="10"/><path d="M34 36 Q50 30 66 36 L70 86 L62 86 L60 60 L60 150 L64 172 L54 172 L52 110 L48 110 L46 172 L36 172 L40 150 L40 60 L38 86 L30 86 Z"/><path d="M34 36 L22 92 L28 94 L40 60 Z"/><path d="M66 36 L78 92 L72 94 L60 60 Z"/>';
  function view(side,prim,sec){
    const regs=R[side].map(([m,shape])=>{ const cls=prim.includes(m)?'p':sec.includes(m)?'s':''; return cls?`<g class="m ${cls}">${shape}</g>`:''; }).join('');
    return `<svg viewBox="0 0 100 180" class="body ${side}" aria-hidden="true"><g class="sil">${BODY}</g>${regs}</svg>`;
  }
  window.muscleMap=function(prim,sec){ prim=prim||[]; sec=sec||[]; const need=side=>R[side].some(([m])=>prim.includes(m)||sec.includes(m));
    const sides=[need('front')?'front':null,need('back')?'back':null].filter(Boolean); if(!sides.length) sides.push('front');
    const names=prim.map(m=>MUSCLE_FR[m]||m); const names2=sec.map(m=>MUSCLE_FR[m]||m);
    return `<div class="mmap">${sides.map(s=>view(s,prim,sec)).join('')}<div class="mleg">${names.length?`<span><i class="p"></i>${names.join(', ')}</span>`:''}${names2.length?`<span><i class="s"></i>${names2.join(', ')}</span>`:''}</div></div>`; };
  window.muscleFr=m=>MUSCLE_FR[m]||m;
})();
