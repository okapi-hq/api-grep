/* global $, axios */

function loadJokes() {
  $.getJSON("https://icanhazdadjoke.com/search", { term: "cat", limit: 5 }, function (data) {
    render(data);
  });
}

function subscribe(email) {
  return $.ajax({
    url: "https://api.convertkit.com/v3/forms/123/subscribe",
    type: "POST",
    contentType: "application/json",
    data: JSON.stringify({ email: email }),
  });
}

function legacySave(id, payload) {
  return $.post("/api/items/" + id, payload);
}

function upload(file) {
  var xhr = new XMLHttpRequest();
  var form = new FormData();
  form.append("file", file);
  xhr.open("POST", "https://api.cloudinary.com/v1_1/demo/image/upload");
  xhr.setRequestHeader("X-Requested-With", "XMLHttpRequest");
  xhr.send(form);
}

function movies(query) {
  return axios.get("https://api.themoviedb.org/3/search/movie", { params: { query: query, api_key: window.TMDB_KEY } });
}

function render() {}
