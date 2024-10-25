/*
Synonyms Plugin
===============
Show a list of synonyms for the current word in the editor in the right sidebar. Click to insert.
*/

const { Plugin, ItemView, setTooltip, setIcon, requestUrl, Notice } = require('obsidian');

const SYNONYM_VIEW = 'synonym-view';

const Config = {
  maxResults: 20, // limit of how many words per heading to return
  maxWords: 10, // limit to selection size, max no. of words
  dictUrl: 'https://en.wiktionary.org/api/rest_v1/page/definition/',
  synUrl: 'https://api.datamuse.com/words?',
  synonymArg: 'rel_syn=',
  antonymArg: 'rel_ant=',
  similarArg: 'ml=',
};

const Lang = {
  name: 'Synonyms',
  introHdr: 'Synonyms',
  synonymsHdr: 'Synonyms',
  antonymsHdr: 'Antonyms',
  similarHdr: 'Similar meanings',
  definitionsHdr: 'Definitions',
  definitionCopied: 'Word definition copied to clipboard',
  clearTip: 'Clear search',
  intro: 'Find synonyms, antonyms, similar meanings, and dictionary definitions.',
  source1: 'Synonyms from <a href="https://api.datamuse.com/words?rel_syn=example">Datamuse</a>',
  source2: 'Dictionary from <a href="https://en.wiktionary.org/api/rest_v1/page/definition/example">Wiktionary</a>',
  more: ' more...',
  searchingSyn: 'Searching for synonyms from Datamuse...',
  searchingDef: 'Searching for definitions from Wiktionary...',
  searchPlc: 'Find synonyms, antonyms, & definitions....',
  findCursorTip: 'Find word at cursor',
  findCursorTxt: 'Click the button beside the search box to find the word at the cursor position',
  hideTip: 'Click to hide',
  insertWordTxt: 'Click a synonym, antonym, or similar meaning to replace the word at the cursor',
  copyDefinitionTxt: 'Click a dictionary definition to copy it to the clipboard',
  clearTxt: 'Click here to clear the search history.',
  help: 'Help',
};

const DEFAULT_SETTINGS = {
  maxHistory: 25,
}

class SynonymSidebarPlugin extends Plugin {
  constructor() {
    super(...arguments);
  }

  async onload() {
    await this.loadSettings();

    this.registerView(
      SYNONYM_VIEW, 
      (leaf) => new SynonymSidebarView(leaf, this),
    );

    this.addCommand({
      id: 'synonym-open',
      name: 'Open sidebar',
      callback: this.activateView.bind(this),
    });
    // biome-ignore lint: Loading indicator, runs once only; // ⚠️
    console.log(`%c${this.manifest.name} ${this.manifest.version} loaded`, 
      'background-color: firebrick; padding:4px; border-radius:4px');
  }
  
  onunload() {}
  
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async activateView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(SYNONYM_VIEW).first();
    if (!leaf) {
      leaf = workspace.getRightLeaf(false); // false => no split
      await leaf.setViewState({
          type: SYNONYM_VIEW,
          active: true,
        });
    }
    workspace.revealLeaf(leaf);
  }
}

class SynonymSidebarView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.settings = plugin.settings;
    this.synonymCache = {};
    this.definitionCache = {};
    this.searchboxEl;
    this.historyEl;
    this.history = [];
    this.helpEl;
    this.expandHelpEl;
    this.helpExpanded = true;
  }

  getViewType() {
    return SYNONYM_VIEW;
  }

  getDisplayText() {
    return Lang.name;
  }

  getIcon() {
    return 'book-a';
  }

  // Update state from workspace
  async setState(state, result) {
    if (state.lookup) {
      this.searchboxEl.value = state.lookup;
    }
    this.history = state.history ?? [];
    this.showHistory();
    await super.setState(state, result);
  }

  // Save state to workspace
  getState() {
    const state = super.getState();
    state.lookup = this.searchboxEl.value;
    state.history = this.history;
    return state;
  }

  async onOpen() {
    let lookup = '';
    let moreSynonyms = [];
    
    // SEARCH BAR
    const rowEl = createDiv({ cls: 'search-row' });
    const contEl = rowEl.createDiv({ cls: 'search-input-container' });
    const searchboxEl = contEl.createEl('input', {
      type: 'search',
      placeholder: Lang.searchPlc,
    });
    this.searchboxEl = searchboxEl;
    const clearEl = contEl.createDiv( {
      cls: 'search-input-clear-button',
    });
    setTooltip(clearEl, Lang.clearTip);
    const cursorBtn = rowEl.createDiv({ cls: 'clickable-icon syn-cursor-icon' });
    setIcon(cursorBtn, 'text-cursor-input');
    setTooltip(cursorBtn, Lang.findCursorTip, { placement: 'bottom' });
    cursorBtn.onclick = () => {
      searchboxEl.value = this.currentWord(this.app);
      searchboxEl.onsearch();
    };
    this.containerEl.prepend(rowEl);  // place at top to ensure it stays fixed
        
    // PLUGIN CONTAINER
    this.contentEl.empty();
    this.contentEl.addClass('syn');

    // START VIEW
    const introEl = this.contentEl.createDiv();

    const historyEl = introEl.createEl('div', { cls: 'syn-history'});
    this.historyEl = historyEl;
    
    // SYNONYM VIEW
    const searchingSynEl = this.contentEl.createDiv({
      text: Lang.searchingSyn,
      cls: 'syn-searching',
    });
    searchingSynEl.hide();
    
    const synonymEl = this.contentEl.createDiv({ cls: 'syn-results'});
    
    // DEFINITION VIEW
    const searchingDefEl = this.contentEl.createDiv({
      text: Lang.searchingDef,
      cls: 'syn-searching',
    });
    searchingDefEl.hide();

    const definitionEl = this.contentEl.createDiv({ cls: 'syn-results'});

    // HELP TOGGLE
    const detailsEl = createEl('details');
    detailsEl.createEl('summary', { text: Lang.help });
    detailsEl.createEl('p', { text: Lang.intro });
    const detailEl = detailsEl.createEl('ul');
    detailEl.createEl('li', { text: Lang.findCursorTxt });
    detailEl.createEl('li', { text: Lang.insertWordTxt });
    detailEl.createEl('li', { text: Lang.copyDefinitionTxt });
    const wipeEl = detailEl.createEl('li', { text: Lang.clearTxt, cls: 'clear-history' });
    detailEl.createEl('li').innerHTML = Lang.source1;
    detailEl.createEl('li').innerHTML = Lang.source2;

    this.contentEl.append(detailsEl);

    // *** EVENTS ****

    searchboxEl.onsearch = async () => {
      lookup = searchboxEl.value;
      searchboxEl.addClass('syn-active-word');
      if (lookup !== '') {
        introEl.hide();
        /** @type {TLookup} */
        const cache = this.getFromHistory(lookup);

        let synonyms = [];
        if (cache?.synonyms) {
          synonyms = cache.synonyms;
        } else {
          searchingSynEl.show();
          synonyms = await this.fetchSynonyms(lookup);
          searchingSynEl.hide();
        }
        if (synonyms) {
          showSynonyms(synonyms, synonymEl);
          moreSynonyms = synonyms; // needed for the 'More..' button feature
        }

        let definitions;  // JSON|null
        if (cache?.definitions) {
          definitions = cache.definitions;
        } else {
          searchingDefEl.show();
          definitions = await this.fetchDefinitions(lookup);
          searchingDefEl.hide();
        }
        if (definitions) {
          showDefinitions(definitions, definitionEl);
        }

        this.addToHistory(lookup, synonyms, definitions); // existing entries will be ignored
        this.showHistory();
      }
    };

    clearEl.onclick = (event) => {
      searchboxEl.removeClass('syn-active-word');
      searchboxEl.value = '';
      synonymEl.empty();
      definitionEl.empty();
      introEl.show();
    };

    historyEl.onclick = (event) => {
      if (event.target.tagName === 'SPAN') {
        searchboxEl.value = event.target.textContent;
        searchboxEl.onsearch();
      }
    }

    wipeEl.onclick = () => {
      this.clearHistory();
      clearEl.onclick();
    }

    /**
     * Replace editor selection with clicked synonym
     * Lookup the currently selected word in the editor
     * @param {event} event
     */
    synonymEl.onclick = (event) => {
      if (event.target.className === 'syn-word') {
        const word = event.target.textContent;
        this.currentWord(this.app, word);
      }
      if (event.target.className === 'syn-more') {
        showSynonyms(moreSynonyms, synonymEl, true);
      }
    }

    definitionEl.onclick = (event) => {
      if (event.target.className === 'syn-definition') {
        navigator.clipboard.writeText(`*${searchboxEl.value}* 🔅${event.target.textContent}`);
        new Notice(Lang.definitionCopied, 2000);
      }
    }
    
    // RENDER functions
    // ****************

    /**
     * Render the datamuse json results to HTML
     * @param {Array<SynonymResults>} results list of synonyms, antonyms and similar words
     * @param {HTMLElement} showEl where to show the results
     * @param {boolean} all show all results?
     */
    function showSynonyms(results, showEl, all = false) {
      showEl.empty();
      for (const result of results) {
        const heading = result.Heading.toUpperCase();
        const len = result.Words.length;
        if (len > 0) {
          showEl.createDiv({ text: heading, cls: 'syn-heading' });
          const end = all ? len : Config.maxResults;
          result.Words.slice(0, end).map((word) => {
            showEl.createSpan( { text: word.word, cls: 'syn-word' });
          });
        } else {
          showEl.createDiv({ text: heading, cls: 'syn-none syn-heading' });
        }
        if (!all && len > Config.maxResults) {
          const more = len - Config.maxResults;
          showEl.createEl('button', { text: more + Lang.more, cls: 'syn-more' });
        }
      }
    }

    /**
     * Render the word definitions from Wiktionary to HTML
     * @param {JSON} definition
     * @param {HTMLElement} showEl where to show the results
     */
    function showDefinitions(definition, showEl) {
      showEl.empty();
      if (definition) {
        showEl.createDiv({ text: Lang.definitionsHdr.toUpperCase(), cls: 'syn-heading' });
        for (const part of definition) {
          const partEl = showEl.createDiv({ text: part.partOfSpeech, cls: 'syn-heading' });
          for (const def of part.definitions) {
            partEl.createDiv({
              text: stripMarkup(def.definition),
              cls: 'syn-definition',
            });
            if (def.examples !== undefined) {
              for (const example of def.examples) {
                partEl.createDiv({
                  text: `“${stripMarkup(example)}”`,
                  cls: 'syn-example',
                });
              }
            }
          }
        }
      } else {
        showEl.createDiv({ text: Lang.definitionsHdr.toUpperCase(), cls: 'syn-none' });
      }
    }

        /**
     * Remove html markup from text
     * @param {string} html html markup
     * @returns {string} plain text
     */
    function stripMarkup(html) {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const text = doc.body.textContent ?? '';
      return text;
    }
  }

  async onClose() {
    this.unload();
  }

  /* 🕒 HISTORY FUNCTIONS */

  showHistory() {
    this.historyEl.empty();
    for (const item of this.history) {
      this.historyEl.createEl('span', { text: item.lookup });
    }
  }
  
  addToHistory(lookup, synonyms, definitions) {
    /** @type {TLookup} */
    const newItem = { lookup, synonyms, definitions };
    this.history = this.history.filter(item => lookup !== item.lookup); // no duplicates
    this.history = [newItem, ...this.history]; // add to the top
    if (this.history.length > this.settings.maxHistory) {
      this.history = this.history.slice(0, this.settings.maxHistory);
    }
  }

  getFromHistory(lookup) {
    const cache = this.history.find((item) => item.lookup === lookup);
    return cache;
  }

  clearHistory() {
    this.history = [];
    this.getState();
    this.showHistory();
  }

  /* 📦 INTERNAL FUNCTIONS */

  /**
   * Get / Set the editor selection
   * In the most recent editor, grabs either:
   * 1. The selected text (up to max number of words); 
   *    NOTE: paragraphs of words make no sense in this context
   * 2. The word at the cursor position
   *
   * @param {obsidian.App} app
   * @param {string} replacement
   * @returns {string}
   */
  currentWord(app, replacement = '') {
    const view = app.workspace.getMostRecentLeaf().view;
    if (view) {
      const editor = view.editor;
      // If there is no selection try to use the word at the cursor position
      if (!editor.somethingSelected()) {
        selectWordAtCursor(editor);
      }
      if (editor.somethingSelected) {
        if (replacement !== '') {
          editor.replaceSelection(replacement);
          selectWordAtCursor(editor);
        } else {
          let sel = editor.getSelection();
          if (sel.indexOf(' ') >= 0) {
            sel = this.firstXWords(sel, Config.maxWords);
          }
          return sel;
        }
      }
    }
    return '';

    function selectWordAtCursor(editor) {
      const wordPos = editor.wordAt(editor.getCursor());
      if (wordPos) {
        editor.setSelection(wordPos.from, wordPos.to);
      }
    }
  }

  /**
   * Fetches the synonyms from Datamuse API
   * @param {string} lookup
   * @returns {Promise<Array>}
   */
  async fetchSynonyms(lookup) {
    /** @type {Array<SynonymResults>} */
    let results = [];
    try {
      const res = await Promise.all([
        fetchUrl(Config.synUrl + Config.synonymArg + lookup),
        fetchUrl(Config.synUrl + Config.antonymArg + lookup),
        fetchUrl(Config.synUrl + Config.similarArg + lookup),
      ]);

      results = [
        { Heading: Lang.synonymsHdr, Words: res[0] },
        { Heading: Lang.antonymsHdr, Words: res[1] },
        { Heading: Lang.similarHdr, Words: res[2] },
      ];
    } catch (error) {
      // biome-ignore lint: ; // ⚠️
      console.log(error);
    }
    return results;
    
    async function fetchUrl(url) {
      let result = null;
      const response = await requestUrl(url);
      if (response.status === 200) {
        result = await response.json;
      }
      return result;
    }
  }

  /**
   * Fetch the word definition from Wikionary API
   * @param {string} word
   * @returns {Promise<JSON|undefined>}
   */
  async fetchDefinitions(word) {
    try {
      const lookup = word.toLowerCase(); // online lookup requires lower case
      const res = await requestUrl(Config.dictUrl + lookup);
      if (res.status === 200) {
        const raw = await res.json;
        return raw.en; // just the English results
      }
    } catch (error) {
      // biome-ignore lint: ; // ⚠️
      console.log(error);
    }
    return undefined;
  }

  /**
   * Returns the first X words from the sentence provided
   * @param {string} sentence
   * @param {number} count how many words
   * @returns {string} Check for empty!
   */
  firstXWords(sentence, count) {
    const rgx = new RegExp(`((\\s*\\S+){${count}})([\\s\\S]*)`, 'gm');
    const match = rgx.exec(sentence);
    return match !== null ? match[1] : '';
  }
}

module.exports = {
  default: SynonymSidebarPlugin,
};

/* ✏️ TYPES */

/**
 * @typedef {{Heading: string, Words: Array<string>}} SynonymResults 
 */ 

/** 
 * @typedef {Object} TLookup 
 * @property {string} lookup
 * @property {Array} synonyms
 * @property {Array} definitions
 */