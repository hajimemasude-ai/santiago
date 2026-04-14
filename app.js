const appState = {
    paragraphs: [],
    currentUtterance: null,
    currentAudio: null,
    isPaused: false,
    speechRate: 0.8,
    wordsMap: new Map(),
    playingContext: null,
    paragraphQueue: [],  // Sentence queue for paragraph mode (mobile TTS length limit workaround)
    dictCache: new Map() // Cache dictionary results
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
    let actualPIndex = 0; // Tracks real paragraph index, ignoring chapter markers
    const chapterMap = []; // { num, firstWordId }
    
    const fragment = document.createDocumentFragment();

    paras.forEach((pText) => {
        const trimmed = pText.trim();
        
        // Detect chapter markers: standalone number 1-12
        if (/^(\d{1,2})$/.test(trimmed) && parseInt(trimmed) >= 1 && parseInt(trimmed) <= 20) {
            const chapterNum = parseInt(trimmed);
            // Store chapter with placeholder firstWordId; will fill after next word is parsed
            chapterMap.push({ num: chapterNum, firstWordId: globalWordId });
            // Render chapter heading element
            const chNode = document.createElement('div');
            chNode.className = 'chapter-heading';
            chNode.id = `chapter-${chapterNum}`;
            chNode.textContent = `Chapter ${chapterNum}`;
            chNode.dataset.chapterNum = chapterNum;
            fragment.appendChild(chNode);
            return; // skip normal paragraph handling
        }

        const pObj = { id: actualPIndex, text: pText, sentences: [], startWordId: null, endWordId: null };
        const pNode = document.createElement('p');
        pNode.className = 'paragraph';
        
        // Match sentences: anything up to punctuation and trailing spaces, or just remaining text
        const sentMatches = pText.match(/.*?[.!?](?:\s+|$)|.+/g) || [pText];
        
        let pCharOffset = 0;
        
        sentMatches.forEach((sText, sIndex) => {
            const sObj = { id: sIndex, text: sText, words: [], pId: actualPIndex, startWordId: null, endWordId: null };
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
                        pIndex: actualPIndex,
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
                    
                    // Click => open dictionary, long press => TTS tooltip
                    setupWordInteraction(wNode, wObj.id);
                    
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
        actualPIndex++; // Only increment for real paragraphs
    });

    container.appendChild(fragment);

    // Build chapter navigation list
    buildChapterNav(chapterMap);

    setupEventListeners();
    
    // Attempt to warm up voices (Mobile requires listener too)
    speechSynthesis.onvoiceschanged = () => {
        speechSynthesis.getVoices();
    };
    speechSynthesis.getVoices();
}

// Setup word click to open dictionary
function setupWordInteraction(wNode, wordId) {
    wNode.addEventListener('click', (e) => {
        e.stopPropagation();
        openDictionary(wordId);
    });
}

// Build Chapter Navigation
function buildChapterNav(chapterMap) {
    const list = document.getElementById('chapter-list');
    if (!chapterMap.length) return;

    chapterMap.forEach(ch => {
        const item = document.createElement('div');
        item.className = 'chapter-item';
        item.innerHTML = `<span>${ch.num}</span> Chapter ${ch.num}`;
        item.addEventListener('click', () => {
            // Scroll to chapter heading
            const heading = document.getElementById(`chapter-${ch.num}`);
            if (heading) {
                heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
                // Add brief flash to heading
                heading.style.background = 'rgba(230,126,34,0.15)';
                setTimeout(() => { heading.style.background = ''; }, 1500);
            }
            // Close panel
            document.getElementById('chapter-panel').classList.remove('visible');
        });
        list.appendChild(item);
    });
}

// ==========================================
// Dictionary Panel Logic
// ==========================================

function openDictionary(wordId) {
    const wObj = appState.wordsMap.get(wordId);
    if (!wObj) return;
    
    const cleanWord = wObj.text.replace(/[^a-zA-Z'-]/g, '').toLowerCase();
    if (!cleanWord) return;
    
    const dictModal = document.getElementById('dict-modal');
    const dictWord = document.getElementById('dict-word');
    const dictPhonetic = document.getElementById('dict-phonetic');
    const dictBody = document.getElementById('dict-body');
    
    // Set word title
    dictWord.textContent = cleanWord;
    dictPhonetic.textContent = '';
    
    // Store current word for pronunciation
    dictModal.dataset.currentWord = cleanWord;
    dictModal.dataset.currentWordId = wordId;
    
    // Show loading
    dictBody.innerHTML = `
        <div class="dict-loading">
            <div class="dict-spinner"></div>
            <span>Looking up "${cleanWord}"...</span>
        </div>
    `;
    
    // Show modal
    dictModal.classList.add('visible');
    
    // Fetch data
    fetchDictionaryData(cleanWord, wObj);
}

function openDictionaryByWord(word) {
    // For clicking synonym chips - look up a new word without a wordId context
    const cleanWord = word.replace(/[^a-zA-Z'-]/g, '').toLowerCase();
    if (!cleanWord) return;
    
    const dictModal = document.getElementById('dict-modal');
    const dictWord = document.getElementById('dict-word');
    const dictPhonetic = document.getElementById('dict-phonetic');
    const dictBody = document.getElementById('dict-body');
    
    dictWord.textContent = cleanWord;
    dictPhonetic.textContent = '';
    dictModal.dataset.currentWord = cleanWord;
    dictModal.dataset.currentWordId = '';
    
    dictBody.innerHTML = `
        <div class="dict-loading">
            <div class="dict-spinner"></div>
            <span>Looking up "${cleanWord}"...</span>
        </div>
    `;
    
    dictModal.classList.add('visible');
    fetchDictionaryData(cleanWord, null);
}

async function fetchDictionaryData(word, wObj) {
    const dictBody = document.getElementById('dict-body');
    const dictPhonetic = document.getElementById('dict-phonetic');
    
    // Check cache
    const cacheKey = word.toLowerCase();
    
    // Parallel fetch: dictionary API + translation
    const dictPromise = appState.dictCache.has(cacheKey) 
        ? Promise.resolve(appState.dictCache.get(cacheKey))
        : fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`)
            .then(r => {
                if (!r.ok) throw new Error('Not found');
                return r.json();
            })
            .then(data => {
                appState.dictCache.set(cacheKey, data);
                return data;
            })
            .catch(err => null);
    
    const transPromise = fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-CN&dt=t&q=${encodeURIComponent(word)}`)
        .then(r => r.json())
        .then(data => data[0][0][0])
        .catch(() => null);
    
    const [dictData, chineseTranslation] = await Promise.all([dictPromise, transPromise]);
    
    // Build result HTML
    let html = '';
    
    // 1. Chinese Translation Section (always show first)
    if (chineseTranslation) {
        html += `
            <div class="dict-chinese-section">
                <div class="dict-chinese-label">中文释义</div>
                <div class="dict-chinese-text">${escapeHtml(chineseTranslation)}</div>
            </div>
        `;
    }
    
    // 2. Sentence Context (from the book)
    if (wObj) {
        const pObj = appState.paragraphs[wObj.pIndex];
        if (pObj) {
            const sObj = pObj.sentences[wObj.sIndex];
            if (sObj) {
                // Highlight the word in the sentence
                const sentenceText = sObj.text.trim();
                const escapedWord = wObj.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const highlighted = sentenceText.replace(
                    new RegExp(`\\b${escapedWord}\\b`, 'i'),
                    `<mark>$&</mark>`
                );
                html += `
                    <div class="dict-context-section">
                        <div class="dict-context-label">📖 Sentence Context</div>
                        <div class="dict-context-text">${highlighted}</div>
                    </div>
                `;
            }
        }
    }
    
    // 3. Dictionary definitions
    if (dictData && Array.isArray(dictData) && dictData.length > 0) {
        const entry = dictData[0];
        
        // Phonetics
        if (entry.phonetics && entry.phonetics.length > 0) {
            const phonetic = entry.phonetics.find(p => p.text) || entry.phonetics[0];
            if (phonetic && phonetic.text) {
                dictPhonetic.textContent = phonetic.text;
            }
            // Store audio URL if available
            const audioPhonetic = entry.phonetics.find(p => p.audio && p.audio.length > 0);
            if (audioPhonetic) {
                document.getElementById('dict-modal').dataset.audioUrl = audioPhonetic.audio;
            } else {
                document.getElementById('dict-modal').dataset.audioUrl = '';
            }
        }
        
        // Phonetic from top level
        if (!dictPhonetic.textContent && entry.phonetic) {
            dictPhonetic.textContent = entry.phonetic;
        }
        
        // Meanings / Parts of speech
        if (entry.meanings && entry.meanings.length > 0) {
            entry.meanings.forEach(meaning => {
                html += `<div class="dict-pos-section">`;
                html += `<div class="dict-pos-badge">${escapeHtml(meaning.partOfSpeech)}</div>`;
                
                // Definitions
                html += `<div class="dict-definition-list">`;
                const defs = meaning.definitions.slice(0, 5); // Show up to 5 definitions
                defs.forEach((def, idx) => {
                    html += `
                        <div class="dict-definition-item">
                            <div class="dict-def-number">${idx + 1}</div>
                            <div class="dict-def-content">
                                <div class="dict-def-text">${escapeHtml(def.definition)}</div>
                                ${def.example ? `<div class="dict-example">"${escapeHtml(def.example)}"</div>` : ''}
                            </div>
                        </div>
                    `;
                });
                html += `</div>`;
                
                // Synonyms
                if (meaning.synonyms && meaning.synonyms.length > 0) {
                    html += `
                        <div class="dict-synonyms-section">
                            <div class="dict-synonyms-label">Synonyms</div>
                            <div class="dict-synonym-chips">
                                ${meaning.synonyms.slice(0, 8).map(s => 
                                    `<span class="dict-synonym-chip" onclick="openDictionaryByWord('${escapeHtml(s)}')">${escapeHtml(s)}</span>`
                                ).join('')}
                            </div>
                        </div>
                    `;
                }
                
                // Antonyms
                if (meaning.antonyms && meaning.antonyms.length > 0) {
                    html += `
                        <div class="dict-antonyms-section">
                            <div class="dict-antonyms-label">Antonyms</div>
                            <div class="dict-antonym-chips">
                                ${meaning.antonyms.slice(0, 8).map(a => 
                                    `<span class="dict-antonym-chip" onclick="openDictionaryByWord('${escapeHtml(a)}')">${escapeHtml(a)}</span>`
                                ).join('')}
                            </div>
                        </div>
                    `;
                }
                
                html += `</div>`;
            });
        }
        
        // Source
        if (entry.sourceUrls && entry.sourceUrls.length > 0) {
            html += `
                <div class="dict-source">
                    Source: <a href="${entry.sourceUrls[0]}" target="_blank" rel="noopener">${entry.sourceUrls[0]}</a>
                </div>
            `;
        }
    } else if (!chineseTranslation) {
        // No data at all
        html = `
            <div class="dict-error">
                <div class="dict-error-icon">📚</div>
                <div class="dict-error-text">No definition found for "<strong>${escapeHtml(word)}</strong>"</div>
                <div class="dict-error-hint">This might be a proper noun or a specialized term.</div>
            </div>
        `;
    } else if (!dictData) {
        // Have translation but no English definition
        html += `
            <div class="dict-error" style="padding: 16px 0;">
                <div class="dict-error-hint">English definitions unavailable for this word. Showing Chinese translation only.</div>
            </div>
        `;
    }
    
    dictBody.innerHTML = html;
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function closeDictionary() {
    document.getElementById('dict-modal').classList.remove('visible');
}

function setupEventListeners() {
    // Chapter FAB toggle
    const chapterPanel = document.getElementById('chapter-panel');
    document.getElementById('btn-chapters').addEventListener('click', (e) => {
        e.stopPropagation();
        chapterPanel.classList.remove('hidden');
        // Toggle visible state
        if (chapterPanel.classList.contains('visible')) {
            chapterPanel.classList.remove('visible');
        } else {
            chapterPanel.classList.add('visible');
        }
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('#chapter-panel') && !e.target.closest('#btn-chapters')) {
            chapterPanel.classList.remove('visible');
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

    // Dictionary TTS action buttons
    document.querySelectorAll('.dict-tts-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const action = e.currentTarget.dataset.action;
            const dictModal = document.getElementById('dict-modal');
            const wordId = parseInt(dictModal.dataset.currentWordId);
            if (!isNaN(wordId)) {
                closeDictionary();
                playText(action, wordId);
            }
        });
    });

    // Dictionary Modal Handlers
    const dictModal = document.getElementById('dict-modal');
    const dictOverlay = document.getElementById('dict-overlay');
    const dictCloseBtn = document.getElementById('dict-close-btn');
    const dictPronounceBtn = document.getElementById('dict-pronounce-btn');

    dictCloseBtn.addEventListener('click', closeDictionary);
    dictOverlay.addEventListener('click', closeDictionary);
    
    // Pronounce button
    dictPronounceBtn.addEventListener('click', () => {
        const word = dictModal.dataset.currentWord;
        if (!word) return;
        
        // Try phonetic audio from API first
        const audioUrl = dictModal.dataset.audioUrl;
        if (audioUrl) {
            const audio = new Audio(audioUrl);
            audio.play().catch(() => {
                // Fallback to Youdao
                playWordAudio(word);
            });
        } else {
            playWordAudio(word);
        }
    });
    
    function playWordAudio(word) {
        const url = `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(word)}&type=2`;
        const audio = new Audio(url);
        audio.play().catch(() => {
            // Final fallback to TTS
            const u = new SpeechSynthesisUtterance(word);
            u.lang = 'en-US';
            u.rate = 0.8;
            const voice = getBestVoice();
            if (voice) u.voice = voice;
            speechSynthesis.speak(u);
        });
    }

    // Esc to close
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeDictionary();
    });

    // Speed Control Toggle
    const btnSpeed = document.getElementById('btn-speed');
    btnSpeed.addEventListener('click', () => {
        if (appState.speechRate === 0.8) {
            appState.speechRate = 1.0;
        } else if (appState.speechRate === 1.0) {
            appState.speechRate = 1.2;
        } else {
            appState.speechRate = 0.8;
        }
        btnSpeed.innerText = appState.speechRate.toFixed(1) + 'x';
    });

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
        appState.paragraphQueue = []; // Stop any pending sentence queue
        if (appState.currentAudio) {
            appState.currentAudio.pause();
            appState.currentAudio = null;
        }
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

    const enVoices = voices.filter(v => v.lang.startsWith('en'));
    if (!enVoices.length) return voices[0];

    // Priority 1: High-quality Natural/Neural voices (Highest Priority for human-like reading)
    let best = enVoices.find(v => v.name.includes('Natural') || v.name.includes('Neural'));
    
    // Priority 2: Google Online voices (usually high quality)
    if (!best) best = enVoices.find(v => v.name.includes('Google') && !v.localService);
    
    // Priority 3: Online voices that aren't local (often higher quality)
    if (!best) best = enVoices.find(v => !v.localService);
    
    // Priority 4: Microsoft local voices (reliable but potentially more robotic)
    if (!best) best = enVoices.find(v => v.localService && v.name.includes('Microsoft'));
    
    // Priority 5: Any other local voice
    if (!best) best = enVoices.find(v => v.localService);
    
    if (best) console.log(`[TTS] Selected voice: ${best.name} (Local: ${best.localService})`);
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
        // --- USE REAL HUMAN VOICE FOR SINGLE WORDS ---
        const cleanWord = wObj.text.replace(/[^a-zA-Z0-9'-]/g, '');
        const audioUrl = `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(cleanWord)}&type=2`; // type=2 is US English
        const wordAudio = new Audio(audioUrl);
        
        clearHighlights();
        wObj.node.classList.add('currently-reading');
        updateUIState('playing', 'word');
        
        wordAudio.onended = () => {
            clearHighlights();
            updateUIState('stopped');
        };
        
        wordAudio.onerror = () => {
            fallbackTTS(wObj.text, [wObj], 0, 'wordStart', mode);
        };
        
        wordAudio.playbackRate = appState.speechRate;
        wordAudio.play();
        appState.isPaused = false;
        
        // Save to state so stop button works
        appState.currentAudio = wordAudio; 
        return; // Skip standard synthesis
    } else if (mode === 'sentence') {
        const sObj = appState.paragraphs[wObj.pIndex].sentences[wObj.sIndex];
        // Start reading from the clicked word
        textToRead = sObj.text.substring(wObj.sStartOffset);
        wordsToTrack = sObj.words.filter(w => w.id >= wordId);
        offsetAdjustment = wObj.sStartOffset;
        offsetKeyStart = 'sStartOffset';
        fallbackTTS(textToRead, wordsToTrack, offsetAdjustment, offsetKeyStart, mode);
    } else if (mode === 'paragraph') {
        const pObj = appState.paragraphs[wObj.pIndex];
        if (!pObj) return;

        appState.paragraphQueue = [];
        pObj.sentences.forEach((s, sIdx) => {
            if (sIdx < wObj.sIndex) return;
            
            let text = s.text;
            let words = s.words;
            let offsetAdj = 0;

            if (sIdx === wObj.sIndex) {
                // First sentence: slice to start from word
                text = s.text.substring(wObj.sStartOffset);
                words = s.words.filter(w => w.id >= wordId);
                offsetAdj = wObj.sStartOffset;
            }

            appState.paragraphQueue.push({ text, words, offsetAdjustment: offsetAdj });
        });

        if (appState.paragraphQueue.length === 0) return;
        updateUIState('playing', mode);
        appState.isPaused = false;
        advanceParagraphQueue();
        return;
    }
}

// Speak next sentence from paragraph queue (allows long paragraphs on mobile)
function advanceParagraphQueue() {
    if (!appState.paragraphQueue || appState.paragraphQueue.length === 0) {
        clearHighlights();
        updateUIState('stopped');
        return;
    }

    const { text, words, offsetAdjustment } = appState.paragraphQueue.shift();

    appState.playingContext = {
        mode: 'paragraph',
        words: words,
        offsetAdjustment: offsetAdjustment,
        offsetKeyStart: 'sStartOffset',
        currentWordId: null,
        totalChars: text.length
    };

    const utterance = new SpeechSynthesisUtterance(text);
    const voice = getBestVoice();
    if (voice) utterance.voice = voice;
    utterance.lang = 'en-US';
    utterance.rate = appState.speechRate;

    if (words.length > 0) {
        clearHighlights();
        words[0].node.classList.add('currently-reading');
    }

    utterance.onboundary = (e) => {
        if (e.name === 'word') {
            const adjustedIndex = e.charIndex + appState.playingContext.offsetAdjustment;
            highlightWordByIndex(adjustedIndex);
        }
    };

    utterance.onend = () => {
        if (!appState.isPaused) advanceParagraphQueue();
    };

    utterance.onerror = (e) => {
        if (e.error !== 'canceled' && e.error !== 'interrupted') {
            advanceParagraphQueue();
        }
    };

    window.speechSynthesis.speak(utterance);
    appState.currentUtterance = utterance;
}

function fallbackTTS(textToRead, wordsToTrack, offsetAdjustment, offsetKeyStart, mode) {
    const utterance = new SpeechSynthesisUtterance(textToRead);
    
    // Assign best voice
    const voice = getBestVoice();
    if (voice) {
        utterance.voice = voice;
    }
    utterance.lang = 'en-US';
    // Use dynamic speed rate selected by user
    utterance.rate = appState.speechRate; 
    
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

    if (wordsToTrack.length > 0) {
        highlightWordByIndex(appState.playingContext.offsetAdjustment); 
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
        statusText.textContent = 'Click any word for definition and reading.';
        appState.isPaused = false;
        appState.currentUtterance = null;
        document.getElementById('progress-bar').style.width = '0%';
    }
}

// Start
document.addEventListener('DOMContentLoaded', initApp);
