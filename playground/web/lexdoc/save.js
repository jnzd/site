// Saves a generated HTML file. Used by the playground and by the full-size
// Lexdoc page (inlined there). iPhone and iPad Safari cannot save a blob: link
// with the download attribute (it navigates to it and fails with
// "WebKitBlobResource error 1"), so there the share sheet offers "Save to
// Files". Elsewhere a download link, attached to the page while it is
// clicked, its URL kept alive long enough for a slow "Save as" dialog.
function lexSaveHtml(html, name) {
  const file = new File([html], name, { type: 'text/html' });
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.userAgent.includes('Mac') && navigator.maxTouchPoints > 1);
  if (ios && navigator.canShare && navigator.canShare({ files: [file] }))
    return navigator.share({ files: [file], title: name }).catch((e) => { if (e.name !== 'AbortError') console.error(e); });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = name;
  a.style.display = 'none';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10 * 60 * 1000);
}
