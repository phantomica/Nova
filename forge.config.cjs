const path = require('node:path')

module.exports = {
  outDir: path.resolve(__dirname, 'release'),
  packagerConfig: {
    asar: {
      unpack: '**/node_modules/@img/sharp-win32-x64/**'
    },
    executableName: 'Nova',
    icon: path.resolve(__dirname, 'resources/icons/nova')
  },
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'Nova',
        setupIcon: path.resolve(__dirname, 'resources/icons/nova.ico')
      }
    }
  ]
}
