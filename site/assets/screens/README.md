Drop real screenshots here, then swap the placeholder frames in `../../index.html` for `<img>` tags:

    01-pouch.png      the pouch with three cards stacked
    02-lock.png       the 4-digit gate, mid-entry
    03-settings.png   Settings -> Lock & backup
    04-restore.png    the "replaces N cards" confirmation

Any phone aspect ratio works (1080x2400 is ideal). In `index.html` replace
`<span class="ph" ...>Settings</span>` with:

    <img src="./assets/screens/01-pouch.png" alt="The pouch with three cards stacked" loading="lazy" width="1080" height="2400">

Screenshots are the only images this site needs, so they are also the only thing that can slow the first paint:
compress them (`pngquant --speed 1` or `oxipng`) and keep each under ~250 KB. The stylesheet already sizes
`.shots img` correctly.
