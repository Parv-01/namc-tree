/* ═══════════════════════════════════════════════════════════════
   tree.js  –  Tree DOM Builder & Interaction Engine
   
   Responsibilities:
     - Parse the raw DevExtreme treeview HTML from TREE_HTML_RAW
     - Re-render each node with our custom .node-row structure
     - Wire toggle (expand/collapse), click-to-open-panel, hover actions
     - Expose expand/collapse/search API to app.js
   ═══════════════════════════════════════════════════════════════ */

const Tree = (() => {

  /* ─── Private state ─── */
  let _panel        = null;   // Detail panel controller (set by App.init)
  let _activeNode   = null;   // Currently selected <li>

  /* ─────────────────────────────────────────────────────────────
     INIT
     Called by app.js after the DOM is ready.
  ───────────────────────────────────────────────────────────── */

  /**
   * Initialise the tree inside `container`.
   * `panelCtrl` is the panel controller object from app.js.
   * @param {HTMLElement} container
   * @param {object} panelCtrl  – must expose: open(code), close()
   */
  function init(container, panelCtrl) {
    _panel = panelCtrl;

    // Clear the loading state
    container.innerHTML = '';

    // Inject the pre-built raw HTML (from tree_data.js)
    const wrapper = document.createElement('div');
    wrapper.innerHTML = TREE_HTML_RAW;
    const rootUL = wrapper.querySelector('ul.dx-treeview-node-container');
    if (!rootUL) {
      container.innerHTML = '<p style="color:red;padding:20px">Tree HTML not found. Check tree_data.js</p>';
      return;
    }

    // Transform every LI node: replace DX markup with our .node-row structure
    _transformSubtree(rootUL);

    container.appendChild(rootUL);
  }

  /* ─────────────────────────────────────────────────────────────
     DOM TRANSFORMATION
     Converts DX TreeView markup → our clean node-row markup.
  ───────────────────────────────────────────────────────────── */

  /**
   * Walk all <li> nodes in a subtree and convert them.
   * @param {HTMLElement} ul
   */
  function _transformSubtree(ul) {
    ul.querySelectorAll('li.dx-treeview-node').forEach(li => _transformNode(li));
  }

  /**
   * Convert a single DX <li> node into our markup.
   * Original structure:
   *   <li data-item-id="..." aria-level="N" aria-label="CODE  term (en)">
   *     <div class="dx-item dx-treeview-item">
   *       <div class="dx-item-content dx-treeview-item-content">
   *         <span>CODE  term (en)</span>
   *       </div>
   *     </div>
   *     <div class="dx-treeview-toggle-item-visibility …"></div>   ← may be present
   *     <ul …>…</ul>
   *   </li>
   *
   * Target structure:
   *   <li data-code="..." aria-level="N">
   *     <div class="node-row">
   *       <button class="node-toggle [open|leaf]">▶</button>
   *       <span class="node-label">CODE  term (en)</span>
   *       [<span class="has-def" title="Has definition">]
   *       <div class="node-actions">
   *         <button class="node-act-btn">+</button>
   *         <button class="node-act-btn del">✕</button>
   *       </div>
   *     </div>
   *     <!-- child <ul> preserved as-is (already transformed recursively) -->
   *   </li>
   */
  function _transformNode(li) {
    // Extract key attributes
    const rawId   = li.getAttribute('data-item-id') || '';
    const code    = _decodeCode(rawId);
    const level   = parseInt(li.getAttribute('aria-level') || '1', 10);
    const label   = (li.getAttribute('aria-label') || '').trim();
    const isLeaf  = li.classList.contains('dx-treeview-node-is-leaf');

    // Store decoded code for lookup
    li.setAttribute('data-code', code);

    // Grab child UL before we wipe innerHTML
    const childUL = li.querySelector(':scope > ul');

    // Build the new node row
    const row = document.createElement('div');
    row.className = 'node-row';

    // Toggle button
    const toggle = document.createElement('button');
    toggle.className = 'node-toggle' + (isLeaf || !childUL ? ' leaf' : ' open');
    toggle.textContent = '▶';
    toggle.setAttribute('aria-label', isLeaf ? 'Leaf node' : 'Toggle children');
    toggle.type = 'button';
    row.appendChild(toggle);

    // Label
    const labelSpan = document.createElement('span');
    labelSpan.className = 'node-label';
    labelSpan.textContent = label;
    row.appendChild(labelSpan);

    // Definition dot
    if (Store.hasDefinition(code)) {
      const dot = document.createElement('span');
      dot.className = 'has-def';
      dot.title = 'Has definition';
      row.appendChild(dot);
    }

    // Node action buttons (+ child, delete)
    const actions = _buildActions(code);
    row.appendChild(actions);

    // Replace li contents but keep child UL
    li.innerHTML = '';
    li.appendChild(row);
    if (childUL) {
      // Start collapsed if level >= 4
      if (level >= 4) li.classList.add('collapsed');
      li.appendChild(childUL);
    }

    // Wire events
    _wireNode(li, toggle, row, code, isLeaf, childUL);
  }

  /** Build the inline +/delete action buttons for a node. */
  function _buildActions(code) {
    const actions = document.createElement('div');
    actions.className = 'node-actions';

    const addBtn = document.createElement('button');
    addBtn.className = 'node-act-btn';
    addBtn.textContent = '+';
    addBtn.title = 'Add child node';
    addBtn.type = 'button';
    addBtn.addEventListener('click', e => {
      e.stopPropagation();
      App.showAddModal(code);
    });

    const delBtn = document.createElement('button');
    delBtn.className = 'node-act-btn del';
    delBtn.textContent = '✕';
    delBtn.title = 'Delete this node';
    delBtn.type = 'button';
    delBtn.addEventListener('click', e => {
      e.stopPropagation();
      App.showDeleteModal(code);
    });

    actions.appendChild(addBtn);
    actions.appendChild(delBtn);
    return actions;
  }

  /** Attach click / toggle listeners to a transformed node. */
  function _wireNode(li, toggle, row, code, isLeaf, childUL) {

    // ── Toggle button (the small arrow) ──
    // Clicking the arrow ONLY toggles — does not open the panel.
    toggle.addEventListener('click', e => {
      e.stopPropagation();
      if (!isLeaf && childUL) {
        li.classList.toggle('collapsed');
        toggle.classList.toggle('open', !li.classList.contains('collapsed'));
      }
    });

    // ── Row click / tap ──
    // A single tap does TWO things:
    //   1. If node has children → expand or collapse it
    //   2. Always → open the detail panel
    row.addEventListener('click', e => {
      // Ignore clicks on the toggle arrow and action buttons
      if (e.target.closest('.node-toggle') || e.target.closest('.node-actions')) return;

      // 1. Expand / collapse if this node has children
      if (!isLeaf && childUL) {
        li.classList.toggle('collapsed');
        toggle.classList.toggle('open', !li.classList.contains('collapsed'));
      }

      // 2. Open the detail panel
      if (!Store.isDeleted(code)) {
        _setActive(li);
        _panel.open(code);
      }
    });
  }

  /** Mark a node as the active (selected) node. */
  function _setActive(li) {
    if (_activeNode) _activeNode.classList.remove('active');
    _activeNode = li;
    li.classList.add('active');
  }

  /* ─────────────────────────────────────────────────────────────
     EXPAND / COLLAPSE
  ───────────────────────────────────────────────────────────── */

  function expandAll() {
    document.querySelectorAll('li.dx-treeview-node').forEach(li => {
      li.classList.remove('collapsed');
      const t = li.querySelector(':scope > .node-row > .node-toggle');
      if (t && !t.classList.contains('leaf')) t.classList.add('open');
    });
  }

  function collapseAll() {
    document.querySelectorAll('li.dx-treeview-node').forEach(li => {
      if (li.querySelector(':scope > ul')) {
        li.classList.add('collapsed');
        const t = li.querySelector(':scope > .node-row > .node-toggle');
        if (t) t.classList.remove('open');
      }
    });
  }

  /**
   * Collapse all nodes whose aria-level >= maxLevel.
   * Expands all above.
   * @param {number} maxLevel
   */
  function collapseToLevel(maxLevel) {
    document.querySelectorAll('li.dx-treeview-node').forEach(li => {
      const lv = parseInt(li.getAttribute('aria-level') || '0', 10);
      const hasChildren = Boolean(li.querySelector(':scope > ul'));
      const toggle = li.querySelector(':scope > .node-row > .node-toggle');
      if (hasChildren) {
        const shouldCollapse = lv >= maxLevel;
        li.classList.toggle('collapsed', shouldCollapse);
        if (toggle) toggle.classList.toggle('open', !shouldCollapse);
      }
    });
  }

  /* ─────────────────────────────────────────────────────────────
     SEARCH
  ───────────────────────────────────────────────────────────── */

  let _searchTimer = null;

  /**
   * Filter the tree to show only nodes matching `query`.
   * Searches: data-code, aria-label text, and the Long_definition field.
   * @param {string} query
   * @returns {number} count of matching nodes
   */
  function search(query) {
    clearTimeout(_searchTimer);
    return _doSearch(query.trim().toLowerCase());
  }

  function _doSearch(q) {
    // Remove previous highlights/classes
    document.querySelectorAll('li.dx-treeview-node').forEach(li => {
      li.classList.remove('search-match', 'search-hidden');
      // Restore deleted-state visibility
      if (Store.isDeleted(li.dataset.code || '')) li.style.display = 'none';
    });
    // Remove old <mark> tags
    document.querySelectorAll('mark').forEach(m => {
      const p = m.parentNode;
      p.replaceChild(document.createTextNode(m.textContent), m);
      p.normalize();
    });

    if (!q) return 0;

    let matchCount = 0;

    document.querySelectorAll('li.dx-treeview-node').forEach(li => {
      const code  = li.dataset.code || '';
      const label = (li.getAttribute('aria-label') || '').toLowerCase();
      const rec   = Store.get(code);
      const def   = rec?.long?.toLowerCase() || '';

      if (label.includes(q) || def.includes(q)) {
        li.classList.add('search-match');
        matchCount++;

        // Highlight in the label span
        const labelSpan = li.querySelector(':scope > .node-row > .node-label');
        if (labelSpan) {
          const text = labelSpan.textContent;
          const idx  = text.toLowerCase().indexOf(q);
          if (idx !== -1) {
            labelSpan.innerHTML =
              _escHtml(text.slice(0, idx)) +
              '<mark>' + _escHtml(text.slice(idx, idx + q.length)) + '</mark>' +
              _escHtml(text.slice(idx + q.length));
          }
        }

        // Expand + un-hide all ancestors
        let ancestor = li.parentElement;
        while (ancestor) {
          if (ancestor.tagName === 'LI') {
            ancestor.classList.remove('collapsed', 'search-hidden');
            const t = ancestor.querySelector(':scope > .node-row > .node-toggle');
            if (t) t.classList.add('open');
          }
          ancestor = ancestor.parentElement;
        }
      } else {
        li.classList.add('search-hidden');
      }
    });

    // Un-hide ancestors of matched nodes (second pass for safety)
    document.querySelectorAll('li.search-match').forEach(li => {
      let ancestor = li.parentElement;
      while (ancestor) {
        if (ancestor.tagName === 'LI') ancestor.classList.remove('search-hidden');
        ancestor = ancestor.parentElement;
      }
    });

    return matchCount;
  }

  /** Clear all search state, restore full tree. */
  function clearSearch() {
    _doSearch('');
  }

  /* ─────────────────────────────────────────────────────────────
     NODE INJECTION  (add new nodes dynamically)
  ───────────────────────────────────────────────────────────── */

  /**
   * Inject a newly created node into the DOM.
   * @param {string} code       – NAMC code for the new node
   * @param {object} rec        – Record from Store
   * @param {string|null} parentCode – Parent node code, or null for root
   */
  function injectNode(code, rec, parentCode) {
    // Find or create target <ul>
    let targetUL = null;
    let parentLevel = 0;

    if (parentCode) {
      const parentLi = document.querySelector(`li.dx-treeview-node[data-code="${CSS.escape(parentCode)}"]`);
      if (parentLi) {
        parentLevel = parseInt(parentLi.getAttribute('aria-level') || '0', 10);
        let ul = parentLi.querySelector(':scope > ul');
        if (!ul) {
          ul = document.createElement('ul');
          ul.className = 'dx-treeview-node-container';
          ul.setAttribute('role', 'group');
          parentLi.appendChild(ul);
          // Give parent a real toggle
          const toggle = parentLi.querySelector(':scope > .node-row > .node-toggle');
          if (toggle) {
            toggle.classList.remove('leaf');
            toggle.classList.add('open');
          }
          parentLi.classList.remove('collapsed');
        }
        targetUL = ul;
      }
    }

    if (!targetUL) {
      targetUL = document.querySelector('#treePanel > ul.dx-treeview-node-container');
    }
    if (!targetUL) return;

    const level   = parentLevel + 1;
    const label   = `${code}  ${rec.term || ''}${rec.en ? ' (' + rec.en + ')' : ''}`;
    const hasChild = false;

    const li = document.createElement('li');
    li.className = 'dx-treeview-node dx-treeview-item-without-checkbox dx-treeview-node-is-leaf';
    li.setAttribute('aria-level', level);
    li.setAttribute('aria-label', label);
    li.setAttribute('role', 'treeitem');
    li.setAttribute('data-code', code);

    const row = document.createElement('div');
    row.className = 'node-row';

    const toggle = document.createElement('button');
    toggle.className = 'node-toggle leaf';
    toggle.textContent = '▶';
    toggle.type = 'button';
    row.appendChild(toggle);

    const labelSpan = document.createElement('span');
    labelSpan.className = 'node-label';
    labelSpan.textContent = label;
    row.appendChild(labelSpan);

    if (rec.long) {
      const dot = document.createElement('span');
      dot.className = 'has-def';
      dot.title = 'Has definition';
      row.appendChild(dot);
    }

    row.appendChild(_buildActions(code));
    li.appendChild(row);
    targetUL.appendChild(li);

    _wireNode(li, toggle, row, code, true, null);

    // Scroll into view
    li.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  /**
   * Remove a node from the DOM.
   * @param {string} code
   */
  function removeNode(code) {
    const li = document.querySelector(`li.dx-treeview-node[data-code="${CSS.escape(code)}"]`);
    if (li) {
      if (_activeNode === li) {
        _activeNode = null;
        _panel.close();
      }
      li.remove();
    }
  }

  /* ─────────────────────────────────────────────────────────────
     HELPERS
  ───────────────────────────────────────────────────────────── */

  /**
   * Decode a raw data-item-id value to the NAMC code string.
   * IDs are URI-encoded in the original DX HTML.
   */
  function _decodeCode(raw) {
    try { return decodeURIComponent(raw).replace(/\+/g, ' ').trim(); }
    catch (_) { return raw.trim(); }
  }

  function _escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  /* ─── Public API ─── */
  return { init, expandAll, collapseAll, collapseToLevel, search, clearSearch, injectNode, removeNode };
})();
