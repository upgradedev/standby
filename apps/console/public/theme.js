(function () {
    var pick = function (value) { return value === 'light' || value === 'dark' ? value : null; };
    var theme = pick(new URLSearchParams(location.search).get('theme'));
    if (!theme) { try { theme = pick(localStorage.getItem('standby.theme.v1')); } catch (error) {} }
    theme = theme || 'dark';
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]').setAttribute('content', theme === 'light' ? '#f2f6fb' : '#0b1018');
  })();
