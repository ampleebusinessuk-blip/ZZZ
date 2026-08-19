/*
  Resize a chosen image to a square avatar in the browser.

  Doing it client-side keeps the upload small (a phone photo is often 5–10 MB,
  well past the server limit) and means the server never has to decode untrusted
  image data — it only ever writes bytes to disk.
*/
export const AVATAR_SIZE = 320

export function fileToAvatarBlob(file, size = AVATAR_SIZE) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error('No image selected'))
    if (!/^image\//.test(file.type)) return reject(new Error('Choose an image file'))

    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      try {
        // Centre-crop to a square, then scale — avoids squashing the picture.
        const side = Math.min(img.width, img.height)
        const sx = (img.width - side) / 2
        const sy = (img.height - side) / 2

        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = size
        const ctx = canvas.getContext('2d')
        ctx.imageSmoothingQuality = 'high'
        ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size)

        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error('Could not process that image'))),
          'image/jpeg',
          0.88
        )
      } catch { reject(new Error('Could not process that image')) }
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file is not a readable image')) }
    img.src = url
  })
}
