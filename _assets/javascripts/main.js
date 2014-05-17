//= require vendor/jquery-2.1.0.min.js
//= require bootstrap
//= require ga
//= require_self

$(document).ready(function() {

  $(".post img").wrap(function() {
    var $this = $(this);
    return '<a href="' + $this.attr('src') + '">' + $this.text() + '</a>';
  });

});
