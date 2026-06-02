(function(){
function cleanOnCanvas(img, targetW, targetH) {
  var c = document.createElement('canvas');
  var w = targetW || img.naturalWidth || 266;
  var h = targetH || img.naturalHeight || 257;
  c.width = w; c.height = h;
  var ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  var d = ctx.getImageData(0, 0, w, h);
  var pix = d.data;
  for (var i = 0; i < pix.length; i += 4) {
    if (pix[i] + pix[i+1] + pix[i+2] < 200) pix[i+3] = 0;
  }
  ctx.putImageData(d, 0, 0);
  return c.toDataURL('image/png');
}

function processImg(img) {
  var dataUrl = cleanOnCanvas(img);
  img.src = dataUrl;
  img.style.display = '';
  img.style.filter = '';
  img.style.mixBlendMode = '';
}

function updateFavicon(dataUrl) {
  var existing = document.querySelector('link[rel="icon"]');
  if (existing) existing.href = dataUrl;
}

document.addEventListener('DOMContentLoaded', function(){
  document.querySelectorAll('img[src*="logo/logo.jpg"], img[src*="logo.jpg"]').forEach(function(img){
    if (img.complete && img.naturalWidth) processImg(img);
    else { img.onload = function(){ processImg(img); }; }
  });

  var favLink = document.querySelector('link[rel="icon"]');
  if (favLink && favLink.href.indexOf('logo') > -1) {
    var hiddenImg = new Image();
    hiddenImg.onload = function(){
      // Favicon at 128x128 for bigger tab rendering
      var dataUrl = cleanOnCanvas(hiddenImg, 128, 128);
      updateFavicon(dataUrl);
      favLink.setAttribute('sizes', '128x128');
    };
    hiddenImg.src = 'logo/logo.jpg?' + Date.now();
  }
});
})();