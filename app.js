const appState = {
    paragraphs: [],
    currentUtterance: null,
    isPaused: false,
    wordsMap: new Map(),
    playingContext: null
};

// Initialize App
function initApp() {
    const container = document.getElementById('reading-container');
    if (!bookContent) {
        container.innerHTML = '<p>No content available.</p>';
        return;
    }

    const paras = bookContent.split(/\n+/).filter(p => p.trim() !== '');
    let globalWordId = 0;
    
    const fragment = document.createDocumentFragment();

    paras.forEach((pText, pIndex) => {
        const pObj = { id: pIndex, text: pText, sentences: [], startWordId: null, endWordId: null };
        const pNode = document.createElement('p');
        pNode.className = 'paragraph';
        
        // Match sentences: anything up to punctuation and trailing spaces, or just remaining text
        const sentMatches = pText.match(/.*?[.!?](?:\s+|$)|.+/g) || [pText];
        
        let pCharOffset = 0;
        
        sentMatches.forEach((sText, sIndex) => {
            const sObj = { id: sIndex, text: sText, words: [], pId: pIndex, startWordId: null, endWordId: null };
            const sNode = document.createElement('span');
            sNode.className = 'sentence';
            
            // Split by words keeping delimiters
            const tokens = sText.split(/([a-zA-Z0-9'-]+)/g);
            let sCharOffset = 0;
            
            tokens.forEach(token => {
                const isWord = /^[a-zA-Z0-9'-]+$/.test(token);
                if (isWord) {
                    const wNode = document.createElement('span');
                    wNode.className = 'word';
                    wNode.textContent = token;
                    wNode.dataset.wId = globalWordId;
                    
                    const wObj = {
                        id: globalWordId,
                        text: token,
                        pIndex: pIndex,
                        sIndex: sIndex,
                        sStartOffset: sCharOffset,
                        sEndOffset: sCharOffset + token.length,
                        pStartOffset: pCharOffset + sCharOffset,
                        pEndOffset: pCharOffset + sCharOffset + token.length,
                        node: wNode
                    };
                    
                    if (sObj.startWordId === null) sObj.startWordId = globalWordId;
                    sObj.endWordId = globalWordId;
                    
                    if (pObj.startWordId === null) pObj.startWordId = globalWordId;
                    pObj.endWordId = globalWordId;
                    
                    appState.wordsMap.set(globalWordId, wObj);
                    sObj.words.push(wObj);
                    sNode.appendChild(wNode);
                    
                    wNode.addEventListener('click', (e) => showTooltip(e, wObj.id));
                    
                    globalWordId++;
                } else {
                    sNode.appendChild(document.createTextNode(token));
                }
                sCharOffset += token.length;
            });
            
            pCharOffset += sText.length;
            pObj.sentences.push(sObj);
            pNode.appendChild(sNode);
        });
        
        appState.paragraphs.push(pObj);
        fragment.appendChild(pNode);
    });

    container.appendChild(fragment);

    setupEventListeners();
    
    // Attempt to warm up voices
    speechSynthesis.getVoices();
}

// Tooltip Management
let activeTooltipWordId = null;

function showTooltip(e, wordId) {
    e.stopPropagation();
    activeTooltipWordId = wordId;
    const tooltip = document.getElementById('action-tooltip');
    
    // Visual feedback for clicked word
    document.querySelectorAll('.word').forEach(w => w.style.boxShadow = 'none');
    e.target.style.boxShadow = '0 2px 4px rgba(230, 126, 34, 0.3)';
    
    tooltip.classList.add('visible');
    
    const rect = e.target.getBoundingClientRect();
    const tooltipWidth = tooltip.offsetWidth || 150;
    const tooltipHeight = tooltip.offsetHeight || 120;
    
    let left = rect.left + rect.width / 2 - tooltipWidth / 2;
    let top = rect.top - tooltipHeight - 10;
    
    if (top < 10) {
       top = rect.bottom + 10;
       tooltip.classList.add('below');
    } else {
       tooltip.classList.remove('below');
    }
    
    if (left < 10) left = 10;
    if (left + tooltipWidth > window.innerWidth - 10) left = window.innerWidth - tooltipWidth - 10;
    
    tooltip.style.left = left + 'px';
    tooltip.style.top = top + 'px';
}

function hideTooltip() {
    const tooltip = document.getElementById('action-tooltip');
    tooltip.classList.remove('visible');
    if (activeTooltipWordId !== null) {
        const wObj = appState.wordsMap.get(activeTooltipWordId);
        if (wObj && !wObj.node.classList.contains('currently-reading')) {
            wObj.node.style.boxShadow = 'none';
        }
    }
}

function setupEventListeners() {
    document.addEventListener('click', (e) => {
        if (!e.target.closest('#action-tooltip')) {
            hideTooltip();
        }
        // Handle closing search dropdown
        if (!e.target.closest('.search-wrapper')) {
            document.getElementById('search-results').classList.add('hidden');
        }
    });

    // Search Logic
    const searchInput = document.getElementById('search-input');
    const searchResults = document.getElementById('search-results');

    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim();
        if (query.length < 2) {
            searchResults.classList.add('hidden');
            return;
        }
        
        let matches = [];
        appState.paragraphs.forEach(p => {
            const textLow = p.text.toLowerCase();
            let startIndex = 0;
            let index;
            while ((index = textLow.indexOf(query, startIndex)) > -1) {
                let targetWord = null;
                for (let s of p.sentences) {
                    for (let w of s.words) {
                        if (w.pEndOffset > index) {
                            targetWord = w;
                            break;
                        }
                    }
                    if (targetWord) break;
                }
                
                if (targetWord) {
                    const snippetStart = Math.max(0, index - 30);
                    const snippetEnd = Math.min(p.text.length, index + query.length + 30);
                    let snippet = p.text.substring(snippetStart, snippetEnd);
                    
                    if (snippetStart > 0) snippet = '...' + snippet;
                    if (snippetEnd < p.text.length) snippet = snippet + '...';
                    
                    // Highlight match in snippet
                    const queryRegex = e.target.value.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // escape regex
                    const regex = new RegExp(`(${queryRegex})`, 'gi');
                    const highlightedSnippet = snippet.replace(regex, `<span class="search-highlight">$1</span>`);
                    
                    matches.push({
                        wordId: targetWord.id,
                        html: highlightedSnippet
                    });
                }
                startIndex = index + query.length;
                if (matches.length >= 8) break;
            }
            if (matches.length >= 8) return;
        });
        
        if (matches.length > 0) {
            searchResults.innerHTML = matches.map(m => `
                <div class="search-result-item" data-id="${m.wordId}">
                    ${m.html}
                </div>
            `).join('');
            searchResults.classList.remove('hidden');
        } else {
            searchResults.innerHTML = '<div class="search-result-item" style="color: #999;">No results found...</div>';
            searchResults.classList.remove('hidden');
        }
    });

    searchResults.addEventListener('click', (e) => {
        const item = e.target.closest('.search-result-item');
        if (!item || !item.dataset.id) return;
        
        const wId = parseInt(item.dataset.id);
        const wObj = appState.wordsMap.get(wId);
        if (wObj) {
            wObj.node.scrollIntoView({ behavior: 'smooth', block: 'center' });
            wObj.node.classList.add('search-pulse');
            setTimeout(() => { wObj.node.classList.remove('search-pulse'); }, 3000);
            
            searchResults.classList.add('hidden');
            searchInput.blur();
        }
    });

    document.querySelectorAll('.tooltip-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const action = e.currentTarget.dataset.action;
            if (activeTooltipWordId !== null) {
                if (action === 'translate') {
                    translateWord(activeTooltipWordId);
                } else {
                    playText(action, activeTooltipWordId);
                }
                hideTooltip();
            }
        });
    });

    // Translation Modal Handlers
    const transModal = document.getElementById('translation-modal');
    const transOverlay = document.getElementById('trans-overlay');
    const transClose = document.getElementById('trans-close-btn');

    function closeTranslation() {
        transModal.classList.remove('visible');
    }

    transClose.addEventListener('click', closeTranslation);
    transOverlay.addEventListener('click', closeTranslation);

    // Esc to close
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeTranslation();
    });

    async function translateWord(wordId) {
        const wObj = appState.wordsMap.get(wordId);
        if (!wObj) return;
        
        // Clean word for translation (remove punctuation attached to text if any, though our parse split it)
        const cleanWord = wObj.text.replace(/[^a-zA-Z0-9'-]/g, '');
        
        document.getElementById('trans-word').textContent = cleanWord;
        const transResult = document.getElementById('trans-result');
        transResult.innerHTML = '<span style="color:#95A5A6; font-size:1rem;">Translating...</span>';
        
        transModal.classList.add('visible');
        
        try {
            const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-CN&dt=t&q=${encodeURIComponent(cleanWord)}`;
            const res = await fetch(url);
            if (!res.ok) throw new Error('Network response was not ok');
            const data = await res.json();
            
            const translatedText = data[0][0][0];
            transResult.innerHTML = `<strong>${translatedText}</strong>`;
        } catch(err) {
            console.error('Translation error:', err);
            transResult.innerHTML = '<span style="color:#E74C3C; font-size:1rem;">Failed to fetch translation. Please check connection.</span>';
        }
    }

    document.getElementById('btn-play-pause').addEventListener('click', () => {
        if (appState.isPaused) {
            window.speechSynthesis.resume();
            updateUIState('playing', appState.playingContext?.mode || '');
        } else {
            window.speechSynthesis.pause();
            updateUIState('paused');
        }
    });

    document.getElementById('btn-stop').addEventListener('click', () => {
        window.speechSynthesis.cancel();
        clearHighlights();
        updateUIState('stopped');
    });

    // Handle progress bar animation during reading
    setInterval(() => {
        const progressBar = document.getElementById('progress-bar');
        if (speechSynthesis.speaking && !appState.isPaused && appState.playingContext && appState.playingContext.totalChars > 0) {
            // Approximation because we can't reliably poll exact time of utterance easily
            // Will just use a small animated pulse on the bar for visuals
            progressBar.style.width = '100%';
            progressBar.style.transition = 'width 10s linear'; // Fake progress
        } else if (!speechSynthesis.speaking) {
            progressBar.style.width = '0%';
            progressBar.style.transition = 'none';
        }
    }, 1000);
}

// Voice selection 
function getBestVoice() {
    const voices = speechSynthesis.getVoices();
    if (!voices.length) return null;

    // Prefer English voices
    const enVoices = voices.filter(v => v.lang.startsWith('en'));
    if (!enVoices.length) return voices[0];

    // Priority: Online/Neural > Google > Premium > High Quality default > Standard
    let best = enVoices.find(v => (v.name.includes('Online') || v.name.includes('Neural')) && v.name.includes('Natural'));
    if (!best) best = enVoices.find(v => v.name.includes('Neural'));
    if (!best) best = enVoices.find(v => v.name.includes('Google') && !v.name.includes('Auto'));
    if (!best) best = enVoices.find(v => v.name.includes('Premium'));
    if (!best) best = enVoices.find(v => v.name.includes('Aria'));
    if (!best) best = enVoices.find(v => v.name.includes('Guy'));
    if (!best) best = enVoices.find(v => v.name.includes('Zira')); // Windows default high quality
    
    return best || enVoices[0];
}

// Reading and Highlights
function clearHighlights() {
    document.querySelectorAll('.word.currently-reading').forEach(n => {
        n.classList.remove('currently-reading');
        n.style.boxShadow = 'none';
    });
}

function playText(mode, wordId) {
    window.speechSynthesis.cancel();
    clearHighlights();
    
    const wObj = appState.wordsMap.get(wordId);
    if (!wObj) return;

    let textToRead = "";
    let wordsToTrack = [];
    let offsetAdjustment = 0;
    let offsetKeyStart = '';

    if (mode === 'word') {
        textToRead = wObj.text;
        wordsToTrack = [wObj];
        offsetAdjustment = 0;
        offsetKeyStart = 'wordStart';
    } else if (mode === 'sentence') {
        const sObj = appState.paragraphs[wObj.pIndex].sentences[wObj.sIndex];
        textToRead = sObj.text;
        wordsToTrack = sObj.words;
        offsetAdjustment = 0;
        offsetKeyStart = 'sStartOffset';
    } else if (mode === 'paragraph') {
        const pObj = appState.paragraphs[wObj.pIndex];
        textToRead = pObj.text.substring(wObj.pStartOffset);
        offsetAdjustment = wObj.pStartOffset;
        offsetKeyStart = 'pStartOffset';
        
        pObj.sentences.forEach(s => {
            s.words.forEach(w => {
                if (w.id >= wordId) {
                    wordsToTrack.push(w);
                }
            });
        });
    }

    const utterance = new SpeechSynthesisUtterance(textToRead);
    
    // Assign best voice
    const voice = getBestVoice();
    if (voice) {
        utterance.voice = voice;
    }
    utterance.lang = 'en-US';
    utterance.rate = 0.9;
    
    appState.playingContext = {
        mode: mode,
        words: wordsToTrack,
        offsetAdjustment: offsetAdjustment,
        offsetKeyStart: offsetKeyStart,
        currentWordId: null,
        totalChars: textToRead.length
    };

    utterance.onboundary = (e) => {
        if (e.name === 'word') {
            const adjustedIndex = e.charIndex + appState.playingContext.offsetAdjustment;
            highlightWordByIndex(adjustedIndex);
        }
    };
    
    utterance.onend = () => {
        clearHighlights();
        updateUIState('stopped');
    };

    utterance.onerror = (e) => {
        if (e.error !== 'canceled' && e.error !== 'interrupted') {
            console.error('TTS Error', e);
            clearHighlights();
            updateUIState('stopped');
        }
    };

    // First word highlight immediately
    if (wordsToTrack.length > 0) {
        highlightWordByIndex(appState.playingContext.offsetAdjustment); // Trigger first word manually it often lags
    }

    updateUIState('playing', mode);
    window.speechSynthesis.speak(utterance);
    appState.currentUtterance = utterance;
}

function highlightWordByIndex(charIndex) {
    const ctx = appState.playingContext;
    if (!ctx || ctx.words.length === 0) return;
    
    if (ctx.offsetKeyStart === 'wordStart') {
        clearHighlights();
        ctx.words[0].node.classList.add('currently-reading');
        return;
    }
    
    let targetWord = null;
    for (let i = ctx.words.length - 1; i >= 0; i--) {
        const w = ctx.words[i];
        if (w[ctx.offsetKeyStart] <= charIndex) {
            targetWord = w;
            break;
        }
    }
    
    if (targetWord && ctx.currentWordId !== targetWord.id) {
        clearHighlights();
        targetWord.node.classList.add('currently-reading');
        ctx.currentWordId = targetWord.id;
        
        // Auto-scroll
        const rect = targetWord.node.getBoundingClientRect();
        if (rect.top < 150 || rect.bottom > window.innerHeight - 150) {
            targetWord.node.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }
}

function updateUIState(state, mode = '') {
    const btnPlayPause = document.getElementById('btn-play-pause');
    const btnStop = document.getElementById('btn-stop');
    const textPlayPause = document.getElementById('text-play-pause');
    const iconPlayPause = document.getElementById('icon-play-pause');
    const pulseDot = document.getElementById('pulse-dot');
    const statusText = document.getElementById('status-text');
    
    const uiModeText = mode ? mode.charAt(0).toUpperCase() + mode.slice(1) : '';

    if (state === 'playing') {
        btnPlayPause.disabled = false;
        btnStop.disabled = false;
        textPlayPause.textContent = 'Pause';
        iconPlayPause.innerHTML = '<rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect>';
        pulseDot.className = 'pulse-dot active';
        statusText.textContent = `Reading ${uiModeText}...`;
        appState.isPaused = false;
    } else if (state === 'paused') {
        btnPlayPause.disabled = false;
        btnStop.disabled = false;
        textPlayPause.textContent = 'Resume';
        iconPlayPause.innerHTML = '<polygon points="5 3 19 12 5 21 5 3"></polygon>'; 
        pulseDot.className = 'pulse-dot paused';
        statusText.textContent = 'Paused';
        appState.isPaused = true;
    } else if (state === 'stopped') {
        btnPlayPause.disabled = true;
        btnStop.disabled = true;
        textPlayPause.textContent = 'Pause';
        iconPlayPause.innerHTML = '<rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect>';
        pulseDot.className = 'pulse-dot';
        statusText.textContent = 'Ready to read. Click any word.';
        appState.isPaused = false;
        appState.currentUtterance = null;
        document.getElementById('progress-bar').style.width = '0%';
    }
}

// Start
document.addEventListener('DOMContentLoaded', initApp);
