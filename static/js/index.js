// Add button to display hidden blog posts (see templates/blog-section.html)
document.querySelector('#show-extra-blog').addEventListener('click', () => {
  // remove 'hidden' class from all hidden blog posts
  document.querySelectorAll('.hidden').forEach(div => div.classList.remove('hidden'));
  // hide the button
  document.querySelector('#show-extra-blog').style.display = 'none';
})
