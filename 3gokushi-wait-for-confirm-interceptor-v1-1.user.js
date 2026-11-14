// ==UserScript==
// @name         3gokushi - wait-for-confirm-interceptor v1.1
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  intercept inline confirmOnClick/confirm and show a custom modal that waits for user's choice (prevents auto-OK). For w7.3gokushi.jp.
// @match        https://*.3gokushi.jp/card/domestic_setting.php*
// @match        https://*.3gokushi.jp/facility/territory_status.php*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  /* -------------------------
     カスタム確認ダイアログ（Promiseで待てる）
     ------------------------- */
  function showCustomConfirm(message) {
    return new Promise((resolve) => {
      // 既に表示されていたら先に消す
      const exist = document.getElementById('tm_custom_confirm');
      if (exist) exist.remove();

      // ラップ要素
      const wrap = document.createElement('div');
      wrap.id = 'tm_custom_confirm';
      wrap.style.position = 'fixed';
      wrap.style.left = '50%';
      wrap.style.top = '30%';
      wrap.style.transform = 'translateX(-50%)';
      wrap.style.zIndex = '30000';
      wrap.style.minWidth = '320px';
      wrap.style.maxWidth = '80%';
      wrap.style.background = '#fff';
      wrap.style.border = '1px solid #333';
      wrap.style.borderRadius = '6px';
      wrap.style.boxShadow = '0 6px 24px rgba(0,0,0,0.35)';
      wrap.style.fontFamily = 'sans-serif';
      wrap.style.userSelect = 'text';

      // メッセージ領域
      const msg = document.createElement('div');
      msg.style.padding = '18px 16px';
      msg.style.whiteSpace = 'pre-wrap'; // \n をそのまま表示
      msg.style.lineHeight = '1.4';
      msg.textContent = message;

      // ボタン領域
      const btnbar = document.createElement('div');
      btnbar.style.display = 'flex';
      btnbar.style.justifyContent = 'center';
      btnbar.style.gap = '10px';
      btnbar.style.padding = '12px';
      btnbar.style.background = '#f0f0f0';
      btnbar.style.borderTop = '1px solid #ddd';

      const ok = document.createElement('button');
      ok.textContent = 'OK';
      ok.style.minWidth = '88px';
      ok.style.padding = '6px 10px';
      ok.style.cursor = 'pointer';
      ok.style.borderRadius = '4px';
      ok.style.border = '1px solid #666';
      ok.style.background = '#fff';

      const cancel = document.createElement('button');
      cancel.textContent = 'Cancel';
      cancel.style.minWidth = '88px';
      cancel.style.padding = '6px 10px';
      cancel.style.cursor = 'pointer';
      cancel.style.borderRadius = '4px';
      cancel.style.border = '1px solid #666';
      cancel.style.background = '#fff';

      btnbar.appendChild(ok);
      btnbar.appendChild(cancel);
      wrap.appendChild(msg);
      wrap.appendChild(btnbar);
      document.body.appendChild(wrap);

      // フォーカス制御（OKにフォーカス）
      ok.focus();

      // キーハンドラ（ESCでキャンセル）
      const onKey = (ev) => {
        if (ev.key === 'Escape') {
          cleanup(false);
        } else if (ev.key === 'Enter') {
          // Enter は OK と同じ
          cleanup(true);
        }
      };

      function cleanup(result) {
        document.removeEventListener('keydown', onKey, true);
        const el = document.getElementById('tm_custom_confirm');
        if (el) el.remove();
        resolve(result);
      }

      ok.addEventListener('click', () => cleanup(true));
      cancel.addEventListener('click', () => cleanup(false));
      document.addEventListener('keydown', onKey, true);
    });
  }

  /* -------------------------
     onclick / onsubmit 属性の中に confirmOnClick(...) / confirm(...) を含む要素を捕まえて
     処理を止めてカスタムダイアログを出し、ユーザーが OK なら本来の動作を実行する
     ------------------------- */

  // 簡単に判定するための正規表現
  const confirmRegexp = /\bconfirmOnClick\s*\(\s*(['"`])([\s\S]*?)\1\s*\)|\bconfirm\s*\(\s*(['"`])([\s\S]*?)\3\s*\)/;

  // クリック キャプチャ（capture フェーズ）で先取りする
  document.addEventListener(
    'click',
    async (e) => {
      try {
        // クリックされた要素から、onclick属性を持つ近い祖先を探す
        const candidate = e.target.closest('[onclick]');
        if (!candidate) return;

        const onclickAttr = candidate.getAttribute('onclick') || '';
        if (!confirmRegexp.test(onclickAttr)) return; // confirm を含まなければ何もしない

        // 該当するので、既存の処理を中断する（同期的に元の onclick に true を返して進むのを防ぐ）
        e.preventDefault();
        e.stopImmediatePropagation();

        // メッセージ抽出（confirmOnClick または confirm の最初のマッチ）
        const m = onclickAttr.match(confirmRegexp);
        let rawMessage = '確認しますか？';
        if (m) {
          // m[2] = confirmOnClick のグループ、 m[4] = confirm のグループ
          rawMessage = m[2] !== undefined ? m[2] : m[4] !== undefined ? m[4] : rawMessage;
          // 属性中では "\n" と書かれていることがあるので実際の改行に変換
          rawMessage = rawMessage.replace(/\\n/g, '\n').replace(/\\r/g, '');
        }

        // カスタムダイアログを表示して選択を待つ
        const ok = await showCustomConfirm(rawMessage);

        if (!ok) {
          // キャンセルなら何もしない（元の onclick が return false していたのと同様）
          return;
        }

        // OK のときは、本来行われるはずの動作を模倣する
        //  - a[href] -> ナビゲート（javascript: の場合は属性のjavascriptを評価してみる）
        //  - submit ボタン / form の場合は form.submit()
        //  - それ以外は onclick プロパティ（関数）を呼ぶ（存在すれば）
        const tag = candidate.tagName.toUpperCase();

        if (tag === 'A') {
          const href = candidate.getAttribute('href');
          if (href && href.trim().toLowerCase().startsWith('javascript:')) {
            // href の javascript: を評価（慎重に）
            try {
              // eslint-disable-next-line no-eval
              eval(href.replace(/^\s*javascript:/i, ''));
            } catch (err) {
              console.error('tm: eval href javascript: failed', err);
            }
          } else if (href) {
            // 通常のリンク遷移
            // target があればそれに従う
            const target = candidate.getAttribute('target');
            if (target && target !== '_self') {
              window.open(href, target);
            } else {
              window.location.href = href;
            }
          } else {
            // 特に href なしなら onclick プロパティを呼ぶ
            if (typeof candidate.onclick === 'function') candidate.onclick();
          }
          return;
        }

        // submit系の input/button の場合
        if (tag === 'INPUT' || tag === 'BUTTON') {
          const type = (candidate.getAttribute('type') || '').toLowerCase();
          const isSubmitButton = type === 'submit' || type === 'button' && candidate.form;
          if (isSubmitButton) {
            const form = candidate.form || candidate.closest('form');
            if (form) {
              // form.submit() は onsubmit を通さず送信するので、元の onsubmit に含まれる他の処理を保ちたい場合は注意。
              // ただしここは「confirm を挟む」用途なので通常これで問題ないはずです。
              form.submit();
              return;
            }
          }
        }

        // それ以外の要素は onclick 関数を呼ぶ（inline onclick がプロパティ化されている場合）
        try {
          if (typeof candidate.onclick === 'function') {
            candidate.onclick();
          } else {
            // 最後の手段：onclick属性のコードを eval する（リスクあるので慎重に）
            const code = candidate.getAttribute('onclick');
            if (code && /;|return|confirmOnClick|confirm/.test(code)) {
              // onclick の中の confirm(...) を除去して eval する（confirm が同期的に呼ばれてしまうのを防ぐため）
              const safeCode = code.replace(/\bconfirmOnClick\s*\(\s*(['"`])[\s\S]*?\1\s*\)|\bconfirm\s*\(\s*(['"`])[\s\S]*?\2\s*\)/g, 'true');
              // eslint-disable-next-line no-eval
              eval(safeCode);
            }
          }
        } catch (err) {
          console.warn('tm: fallback onclick exec failed', err);
        }
      } catch (err) {
        console.error('tm: click handler error', err);
      }
    },
    true // capture フェーズで先取り
  );

  // form の onsubmit に confirm があれば submit を捕まえる（予防的）
  document.addEventListener(
    'submit',
    async (e) => {
      try {
        const form = e.target;
        if (!(form instanceof HTMLFormElement)) return;
        const onsubmitAttr = form.getAttribute('onsubmit') || '';
        if (!confirmRegexp.test(onsubmitAttr)) return;

        e.preventDefault();
        e.stopImmediatePropagation();

        const m = onsubmitAttr.match(confirmRegexp);
        let rawMessage = '確認しますか？';
        if (m) {
          rawMessage = m[2] !== undefined ? m[2] : m[4] !== undefined ? m[4] : rawMessage;
          rawMessage = rawMessage.replace(/\\n/g, '\n').replace(/\\r/g, '');
        }

        const ok = await showCustomConfirm(rawMessage);
        if (ok) {
          // 直接送信（onsubmit を再実行したくないため）
          form.submit();
        } else {
          // キャンセル → 何もしない
        }
      } catch (err) {
        console.error('tm: submit handler error', err);
      }
    },
    true
  );

  console.log('tm: confirm interceptor loaded');
})();
