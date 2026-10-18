// ブログ画面の動作(詳細設計 2.5)。データからの表示はすべて textContent・setAttribute で行い、
// innerHTML を使うのは本文断片(無害化済み)の差し込みだけにする。構文は ES2020 までに限る(N-013)。
(function () {
  'use strict';

  var PAGE_SIZE = 10;
  var POSTS_URL = '/data/posts.json';
  var SEARCH_URL = '/data/search-index.json';

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) {
      if (c === null || c === undefined) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function siteName() {
    var meta = document.querySelector('meta[property="og:site_name"]');
    return meta ? meta.getAttribute('content') : '';
  }

  function formatDate(date) {
    var p = date.split('-').map(Number);
    return p[0] + '年' + p[1] + '月' + p[2] + '日';
  }

  function fetchJson(url) {
    return fetch(url).then(function (res) {
      if (res.status !== 200) throw new Error('status ' + res.status);
      return res.json();
    }).then(function (json) {
      if (!json || json.formatVersion !== 1 || !Array.isArray(json.posts)) throw new Error('format');
      return json.posts;
    });
  }

  function errorMessage(text) {
    return el('div', { class: 'card' }, [
      el('p', { class: 'error' }, [text]),
      el('a', { href: location.href }, ['再読み込み']),
    ]);
  }

  function timeEl(date) {
    return el('time', { datetime: date }, [formatDate(date)]);
  }

  function displayTitle(post) {
    return post.draft === true ? '[下書き]' + post.title : post.title;
  }

  function postCard(post, options) {
    var withTaxonomy = !options || options.taxonomy !== false;
    var meta = el('div', { class: 'meta' }, [timeEl(post.date)]);
    if (withTaxonomy) {
      if (post.updated) meta.appendChild(el('span', {}, ['更新:', timeEl(post.updated)]));
      meta.appendChild(el('a', { href: '/?category=' + encodeURIComponent(post.category) }, [post.category]));
    }
    var card = el('article', { class: 'card post-card' }, [
      el('h2', {}, [el('a', { href: '/posts/' + encodeURIComponent(post.slug) + '/' }, [displayTitle(post)])]),
      meta,
      el('p', {}, [post.summary]),
    ]);
    if (withTaxonomy && post.tags.length > 0) {
      card.appendChild(el('ul', { class: 'tags' }, post.tags.map(function (t) {
        return el('li', {}, [el('a', { class: 'tag', href: '/?tag=' + encodeURIComponent(t) }, ['#' + t])]);
      })));
    }
    return card;
  }

  // 2.5.1 共通
  function prefetchSearchIndex() {
    if (document.body.dataset.page === 'search') return;
    if (navigator.connection && navigator.connection.saveData) return;
    var run = function () {
      fetch(SEARCH_URL, { priority: 'low' }).then(function (res) {
        return res.arrayBuffer();
      }).catch(function () {});
    };
    var schedule = function () {
      if (window.requestIdleCallback) window.requestIdleCallback(run);
      else setTimeout(run, 2000);
    };
    if (document.readyState === 'complete') schedule();
    else window.addEventListener('load', schedule);
  }

  function initCommon() {
    prefetchSearchIndex();
  }

  // 2.5.2 FN-010 記事一覧
  function parsePage(value) {
    return value && /^[1-9][0-9]{0,4}$/.test(value) ? Number(value) : 1;
  }

  function listUrl(filter, page) {
    var params = new URLSearchParams();
    if (filter) params.set(filter.key, filter.value);
    if (page > 1) params.set('page', String(page));
    var q = params.toString();
    return '/' + (q ? '?' + q : '');
  }

  function initList() {
    var params = new URLSearchParams(location.search);
    var page = parsePage(params.get('page'));
    var filter = null;
    if (params.has('category')) filter = { key: 'category', label: 'カテゴリ', value: params.get('category') };
    else if (params.has('tag')) filter = { key: 'tag', label: 'タグ', value: params.get('tag') };
    if (page === 1 && !filter) return;

    var list = document.getElementById('post-list');
    var pager = document.getElementById('pager');
    var filterBox = document.getElementById('list-filter');
    if (filter) {
      clear(filterBox);
      filterBox.appendChild(el('strong', {}, [filter.label + ':' + filter.value]));
      filterBox.appendChild(el('a', { href: '/' }, ['絞り込みを解除']));
      filterBox.hidden = false;
      document.title = filter.label + ':' + filter.value + ' | ' + siteName();
    }

    fetchJson(POSTS_URL).then(function (posts) {
      var matched = posts.filter(function (p) {
        if (!filter) return true;
        return filter.key === 'category' ? p.category === filter.value : p.tags.indexOf(filter.value) !== -1;
      });
      var total = Math.ceil(matched.length / PAGE_SIZE);
      clear(list);
      clear(pager);
      if (page > total) {
        list.appendChild(el('div', { class: 'card empty' }, [
          '該当する記事はありません。', el('br'), el('a', { href: listUrl(filter, 1) }, ['1 ページ目へ']),
        ]));
        pager.hidden = true;
        return;
      }
      matched.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).forEach(function (p) {
        list.appendChild(postCard(p));
      });
      if (total > 1) {
        if (page > 1) pager.appendChild(el('a', { href: listUrl(filter, page - 1) }, ['‹ 前へ']));
        pager.appendChild(el('span', {}, [page + ' / ' + total]));
        if (page < total) pager.appendChild(el('a', { href: listUrl(filter, page + 1) }, ['次へ ›']));
        pager.hidden = false;
      } else {
        pager.hidden = true;
      }
    }).catch(function () {
      clear(list);
      clear(pager);
      pager.hidden = true;
      list.appendChild(errorMessage('記事一覧を読み込めませんでした。'));
    });
  }

  // 2.5.3 FN-011 記事詳細
  function initPost() {
    var body = document.getElementById('post-body');
    body.setAttribute('aria-busy', 'true');
    var controller = new AbortController();
    var timer = setTimeout(function () {
      controller.abort();
    }, 10000);
    fetch('body.html', { signal: controller.signal }).then(function (res) {
      if (res.status !== 200) throw new Error('status ' + res.status);
      return res.text();
    }).then(function (html) {
      // body.html は変換時に許可リストで無害化済み(N-008)
      body.innerHTML = html;
    }).catch(function () {
      clear(body);
      var button = el('button', { class: 'btn', type: 'button' }, ['再読み込み']);
      button.addEventListener('click', function () {
        location.reload();
      });
      body.appendChild(el('p', { class: 'error' }, ['本文を読み込めませんでした。']));
      body.appendChild(button);
    }).finally(function () {
      clearTimeout(timer);
      body.setAttribute('aria-busy', 'false');
    });
  }

  // 2.5.4 FN-012 タグ・カテゴリ一覧
  function countBy(posts, pick) {
    var counts = new Map();
    posts.forEach(function (p) {
      pick(p).forEach(function (name) {
        counts.set(name, (counts.get(name) || 0) + 1);
      });
    });
    return Array.from(counts.entries()).sort(function (a, b) {
      return b[1] - a[1] || a[0].localeCompare(b[0], 'ja');
    });
  }

  function initTags() {
    var catBox = document.getElementById('category-list');
    var tagBox = document.getElementById('tag-list');
    fetchJson(POSTS_URL).then(function (posts) {
      var cats = countBy(posts, function (p) { return [p.category]; });
      var tags = countBy(posts, function (p) { return p.tags; });
      clear(catBox);
      clear(tagBox);
      if (cats.length === 0) catBox.appendChild(el('p', { class: 'status' }, ['まだありません。']));
      else {
        catBox.appendChild(el('ul', { class: 'cat-list' }, cats.map(function (c) {
          return el('li', {}, [
            el('a', { href: '/?category=' + encodeURIComponent(c[0]) }, [c[0]]),
            el('span', {}, [c[1] + ' 件']),
          ]);
        })));
      }
      if (tags.length === 0) tagBox.appendChild(el('p', { class: 'status' }, ['まだありません。']));
      else {
        tagBox.appendChild(el('ul', { class: 'tags' }, tags.map(function (t) {
          return el('li', {}, [el('a', { class: 'tag', href: '/?tag=' + encodeURIComponent(t[0]) }, ['#' + t[0], el('small', {}, [String(t[1])])])]);
        })));
      }
    }).catch(function () {
      clear(catBox);
      clear(tagBox);
      catBox.appendChild(errorMessage('一覧を読み込めませんでした。'));
    });
  }

  // 2.5.5 FN-013 サイト内検索
  function normalize(s) {
    return s.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function initSearch() {
    var form = document.getElementById('search-form');
    var input = document.getElementById('search-input');
    var status = document.getElementById('search-status');
    var results = document.getElementById('search-results');
    var index = null;
    var timer = null;

    input.value = new URLSearchParams(location.search).get('q') || '';
    status.textContent = '検索データを読み込み中…';

    function run() {
      if (!index) return;
      var q = input.value;
      var terms = normalize(q).split(' ').filter(Boolean);
      clear(results);
      if (terms.length === 0) {
        status.textContent = 'キーワードを入力してください。';
        return;
      }
      var hits = index.filter(function (entry) {
        return terms.every(function (t) {
          return entry.hay.indexOf(t) !== -1;
        });
      });
      if (hits.length === 0) {
        status.textContent = '見つかりませんでした。';
        return;
      }
      status.textContent = hits.length + ' 件';
      hits.forEach(function (entry) {
        results.appendChild(postCard(entry.post, { taxonomy: false }));
      });
    }

    function updateUrl() {
      var url = new URL(location.href);
      if (input.value) url.searchParams.set('q', input.value);
      else url.searchParams.delete('q');
      history.replaceState(null, '', url.pathname + url.search);
    }

    input.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        updateUrl();
        run();
      }, 200);
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      clearTimeout(timer);
      updateUrl();
      run();
    });

    fetchJson(SEARCH_URL).then(function (posts) {
      index = posts.map(function (p) {
        return { post: p, hay: normalize(p.title + ' ' + p.summary + ' ' + p.tags.join(' ')) + ' ' + p.text };
      });
      run();
    }).catch(function () {
      clear(status);
      status.appendChild(el('span', { class: 'error' }, ['検索データを読み込めませんでした。']));
      status.appendChild(document.createTextNode(' '));
      status.appendChild(el('a', { href: location.href }, ['再読み込み']));
    });
  }

  var INIT = { index: initList, post: initPost, tags: initTags, search: initSearch };

  document.addEventListener('DOMContentLoaded', function () {
    initCommon();
    var init = INIT[document.body.dataset.page];
    if (init) init();
  });
})();
