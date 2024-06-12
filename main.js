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
  searchPlc: 'Find synonyms & definitions....',
  findCursorTip: 'Find word at cursor',
  findCursorTxt: 'Click the button beside the search box to find the word at the cursor position',
  insertWordTxt: 'Click a synonym, antonym, or similar meaning to replace the word at the cursor',
  copyDefinitionTxt: 'Click a dictionary definition to copy it to the clipboard',
};

class SynonymSidebarPlugin extends Plugin {
  constructor() {
    super(...arguments);
  }

  async onload() {
    this.registerView(
      SYNONYM_VIEW, 
      (leaf) => (this.view = new SynonymSidebarView(leaf, this)),
    );

    this.app.workspace.onLayoutReady(this.activateView.bind(this));
    
    console.log('%c' + this.manifest.name + ' ' + this.manifest.version +
      ' loaded', 'background-color: firebrick; padding:4px; border-radius:4px');
  }
  
  onunload() {}

  async activateView() {
    const { workspace } = this.app;
    const [leaf] = workspace.getLeavesOfType(SYNONYM_VIEW);
    if (!leaf) {
      await this.app.workspace
        .getRightLeaf(false) // false = no split
        .setViewState({
          type: SYNONYM_VIEW,
          active: true,
        });
    }
    if (leaf) {
      workspace.revealLeaf(leaf);
    }
  }
}

class SynonymSidebarView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.scache = {};
    this.dcache = {};
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

  async onOpen() {
    let lookup = '';
    let results_cache = [];
    
    // SEARCH BAR
    const row = createDiv({ cls: 'search-row' });
    const cont = row.createDiv({ cls: 'search-input-container' });
    const search_box = cont.createEl('input', {
      type: 'search',
      placeholder: Lang.searchPlc,
    });
    const search_clear = cont.createDiv( {
      cls: 'search-input-clear-button',
    });
    setTooltip(search_clear, Lang.clearTip);
    const cursorBtn = row.createDiv({ cls: 'clickable-icon syn-cursor-icon' });
    setIcon(cursorBtn, 'text-cursor-input');
    setTooltip(cursorBtn, Lang.findCursorTip, { placement: 'bottom' });
    cursorBtn.onclick = () => {
      search_box.value = this.currentWord(this.app);
      search_box.onsearch();
    };
    this.containerEl.prepend(row);  // place at top to ensure it stays fixed
        
    // PLUGIN CONTAINER
    const content = this.contentEl;
    content.empty();
    content.addClass('syn');

    // START VIEW
    const start_view = content.createDiv();
    start_view.createDiv({ text: Lang.intro, cls: 'syn-intro' });
    const help = start_view.createEl('ul', { cls: 'syn-help'});
    help.createEl('li', { text: Lang.findCursorTxt });
    help.createEl('li', { text: Lang.insertWordTxt });
    help.createEl('li', { text: Lang.copyDefinitionTxt });
    help.createEl('li').innerHTML = Lang.source1;
    help.createEl('li').innerHTML = Lang.source2;

    // SYNONYM VIEW
    const search_syn_view = content.createDiv({
      text: Lang.searchingSyn,
      cls: 'syn-info',
    });
    search_syn_view.hide();

    const synonym_view = content.createDiv({ cls: 'syn-results'});

    // DEFINITION VIEW
    const search_def_view = content.createDiv({
      text: Lang.searchingDef,
      cls: 'syn-info',
    });
    search_def_view.hide();

    const definition_view = content.createDiv({ cls: 'syn-results'});

    // *** EVENTS ****

    search_box.onsearch = () => {
      search_box.addClass('syn-active-word');
      lookup = search_box.value;
      if (lookup !== '') {
        start_view.hide();
        search_syn_view.show();
        this.fetchSynonyms(lookup).then((results) => {
          search_syn_view.hide();
          showSynonyms(results, synonym_view);
          results_cache = results; // needed for the 'More..' button feature
        });
        search_def_view.show();
        this.fetchDefinitions(lookup).then((word) => {
          search_def_view.hide();
          showDefinitions(word, definition_view);
          showFiller(definition_view);
        });
      }
    };

    search_clear.onclick = () => {
      search_box.removeClass('syn-active-word');
      search_box.value = '';
      synonym_view.empty();
      definition_view.empty();
      start_view.show();
    };

    /**
     * Replace editor selection with clicked synonym
     * Lookup the currently selected word in the editor
     * @param {event} evt
     */
    synonym_view.onclick = (evt) => {
      if (evt.target.className === 'syn-word') {
        const word = evt.target.textContent;
        this.currentWord(this.app, word);
      }
      if (evt.target.className === 'syn-button') {
        showSynonyms(results_cache, synonym_view, true);
      }
    }

    definition_view.onclick = (evt) => {
      if (evt.target.className === 'syn-def') {
        navigator.clipboard.writeText('*' + search_box.value + '* 🔅' + evt.target.textContent);
        new Notice(Lang.definitionCopied, 2000);
      }
    }
    
    // RENDER functions
    // ****************

    /**
     * Render the datamuse json results to HTML
     * @param {Array<SynonymResult>} results list of synonyms, antonyms and similar words
     * @param {HTMLElement} view where to show the results
     */
    function showSynonyms(results, view, all = false) {
      view.empty();
      let heading, len;
      for (const result of results) {
        heading = result.Heading.toUpperCase();
        len = result.Words.length;
        if (len > 0) {
          const hdr = view.createDiv({ text: heading, cls: 'syn-heading' });
          const end = all ? len : Config.maxResults;
          result.Words.slice(0, end).map((word) => {
            view.createSpan( { text: word.word, cls: 'syn-word' });
          });
        } else {
          view.createDiv({ text: heading, cls: 'syn-none syn-heading' });
        }
      }
      if (!all && len > Config.maxResults) {
        const more = len - Config.maxResults;
        view.createEl('button', { text: more + Lang.more, cls: 'syn-button' });
      }
    }

    /**
     * Render the word definitions from Wiktionary to HTML
     * @param {JSON} word
     * @param {HTMLElement} view
     */
    function showDefinitions(word, view) {
      view.empty();
      if (word) {
        const hdr = view.createDiv({ text: Lang.definitionsHdr.toUpperCase(), cls: 'syn-heading' });
        word.forEach((part) => {
          const POS = view.createDiv({ text: part.partOfSpeech, cls: 'syn-heading' });
          part.definitions.forEach((def) => {
            POS.createDiv({
              text: stripMarkup(def.definition),
              cls: 'syn-def',
            });
            if (def.examples !== undefined) {
              def.examples.forEach((ex) => {
                POS.createDiv({
                  text: '“' + stripMarkup(ex) + '”',
                  cls: 'syn-ex',
                });
              });
            }
          });
        });
      } else {
        view.createDiv({ text: Lang.definitionsHdr.toUpperCase(), cls: 'syn-none' });
      }
    }

        /**
     * Remove html markup from text
     * @param {string} html
     * @returns {string} plain text
     */
    function stripMarkup(html) {
      let doc = new DOMParser().parseFromString(html, 'text/html');
      let text = doc.body.textContent ?? '';
      return text;
    }

    function showFiller(view) {
      view.createDiv({ text: '🔅', cls: 'syn-info' });
    }
  }

  async onClose() {
    this.unload();
  }

  /* INTERNAL FUNCTIONS */

  /**
   * Get or set the editor selection
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
      const word_pos = editor.wordAt(editor.getCursor());
      if (word_pos) {
        editor.setSelection(word_pos.from, word_pos.to);
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
    if (lookup in this.scache) return this.scache[lookup];
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
    this.scache[lookup] = results;
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
    if (word in this.dcache) return this.dcache[word];
    try {
      word = word.toLowerCase(); // online lookup requires lower case
      let res = await requestUrl(Config.dictUrl + word);
      if (res.status === 200) {
        let raw = await res.json;
        this.dcache[word] = raw.en;
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