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
  expandHelp: 'Help…',
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
      (leaf) => (this.view = new SynonymSidebarView(leaf, this)),
    );

    this.addCommand({
      id: 'synonym-open',
      name: 'Open sidebar',
      callback: this.activateView.bind(this),
    });

    //this.app.workspace.onLayoutReady(this.activateView.bind(this));
    
    console.log('%c' + this.manifest.name + ' ' + this.manifest.version +
      ' loaded', 'background-color: firebrick; padding:4px; border-radius:4px');
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
    this.expandHelp(state.help ?? true);
    await super.setState(state, result);
  }

  // Save state to workspace
  getState() {
    let state = super.getState();
    state.lookup = this.searchboxEl.value;
    state.history = this.history;
    state.help = this.helpExpanded;
    return state;
  }

  async onOpen() {
    let lookup = '';
    let resultCache = [];
    
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
   
    const expandHelpEl = introEl.createEl('div', { cls: 'syn-show-help' });
    setIcon(expandHelpEl, 'help');
    setTooltip(expandHelpEl, Lang.expandHelp, { placement: 'left' });
    this.expandHelpEl = expandHelpEl;

    const helpEl = introEl.createDiv({ text: Lang.intro, cls: 'syn-help'});
    const listEl = helpEl.createEl('ul');
    listEl.createEl('li', { text: Lang.findCursorTxt });
    listEl.createEl('li', { text: Lang.insertWordTxt });
    listEl.createEl('li', { text: Lang.copyDefinitionTxt });
    const wipeEl = listEl.createEl('li', { text: Lang.clearTxt , cls: 'clear-history' });
    listEl.createEl('li').innerHTML = Lang.source1;
    listEl.createEl('li').innerHTML = Lang.source2;
    setTooltip(helpEl, Lang.hideTip);
    this.helpEl = helpEl;

    this.expandHelp(this.helpExpanded);

    // SYNONYM VIEW
    const searchingEl = this.contentEl.createDiv({
      text: Lang.searchingSyn,
      cls: 'syn-searching',
    });
    searchingEl.hide();

    const synonymEl = this.contentEl.createDiv({ cls: 'syn-results'});

    // DEFINITION VIEW
    const searchingDefEl = this.contentEl.createDiv({
      text: Lang.searchingDef,
      cls: 'syn-searching',
    });
    searchingDefEl.hide();

    const definitionEl = this.contentEl.createDiv({ cls: 'syn-results'});

    // *** EVENTS ****

    searchboxEl.onsearch = () => {
      lookup = searchboxEl.value;
      searchboxEl.addClass('syn-active-word');
      if (lookup !== '') {
        introEl.hide();
        searchingEl.show();
        this.fetchSynonyms(lookup).then((results) => {
          searchingEl.hide();
          showSynonyms(results, synonymEl);
          resultCache = results; // needed for the 'More..' button feature
        });
        searchingDefEl.show();
        this.fetchDefinitions(lookup).then((word) => {
          searchingDefEl.hide();
          showDefinitions(word, definitionEl);
          showFiller(definitionEl);
        });
        this.addToHistory(lookup);
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
        showSynonyms(resultCache, synonymEl, true);
      }
    }

    definitionEl.onclick = (event) => {
      if (event.target.className === 'syn-definition') {
        navigator.clipboard.writeText('*' + searchboxEl.value + '* 🔅' + event.target.textContent);
        new Notice(Lang.definitionCopied, 2000);
      }
    }

    expandHelpEl.onclick = () => {
      this.expandHelp(true);
    }

    helpEl.onclick = () => {
      this.expandHelp(false);
    }
    
    // RENDER functions
    // ****************

    /**
     * Render the datamuse json results to HTML
     * @param {Array<SynonymResult>} results list of synonyms, antonyms and similar words
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
        definition.forEach((part) => {
          const partEl = showEl.createDiv({ text: part.partOfSpeech, cls: 'syn-heading' });
          part.definitions.forEach((def) => {
            partEl.createDiv({
              text: stripMarkup(def.definition),
              cls: 'syn-definition',
            });
            if (def.examples !== undefined) {
              def.examples.forEach((example) => {
                partEl.createDiv({
                  text: '“' + stripMarkup(example) + '”',
                  cls: 'syn-example',
                });
              });
            }
          });
        });
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
      let doc = new DOMParser().parseFromString(html, 'text/html');
      let text = doc.body.textContent ?? '';
      return text;
    }

    function showFiller(view) {
      view.createDiv({ text: '🔅', cls: 'syn-searching' });
    }
  }

  async onClose() {
    this.unload();
  }

  /* INTERNAL FUNCTIONS */

  expandHelp(isExpanded) {
    if (isExpanded) {
      this.expandHelpEl.hide();
      this.helpEl.show();
    } else {
      this.helpEl.hide();
      this.expandHelpEl.show();
    }
    this.helpExpanded = isExpanded;
  }

  showHistory() {
    this.historyEl.empty();
    this.history.forEach((item) => {
      this.historyEl.createEl('span', { text: item });
    });
  }

  clearHistory() {
    this.history = [];
    this.getState();
    this.showHistory();
  }

  addToHistory(lookup) {
    this.history = this.history.filter(item => item !== lookup); // no duplicates
    this.history = [lookup, ...this.history]; // add to the top
    if (this.history.length > this.settings.maxHistory) {
      this.history = this.history.slice(0, this.settings.maxHistory);
    }
  }

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
   * @typedef {{Heading: string, Word: Array<string>}} SynonymResult
   * @param {string} lookup
   * @returns {Array<SynonymResult>}
   */
  async fetchSynonyms(lookup) {
    if (lookup in this.synonymCache) return this.synonymCache[lookup];
    let results = [];
    try {
      let res = await Promise.all([
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
      console.log(error);
    }
    this.synonymCache[lookup] = results;
    return results;
    
    async function fetchUrl(url) {
      let result = null;
      let response = await requestUrl(url);
      if (response.status === 200) {
        result = await response.json;
      }
      return result;
    }
  }

  /**
   * Fetch the word definition from Wikionary API
   * @param {string} word
   * @returns {JSON|undefined}
   */
  async fetchDefinitions(word) {
    if (word in this.definitionCache) return this.definitionCache[word];
    try {
      word = word.toLowerCase(); // online lookup requires lower case
      let res = await requestUrl(Config.dictUrl + word);
      if (res.status === 200) {
        let raw = await res.json;
        this.definitionCache[word] = raw.en;
        return raw.en; // just the English results
      }
    } catch (error) {
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
    const rgx = new RegExp('((\\s*\\S+){' + count + '})([\\s\\S]*)', 'gm');
    let match = rgx.exec(sentence);
    return match !== null ? match[1] : '';
  }
}

module.exports = {
  default: SynonymSidebarPlugin,
};