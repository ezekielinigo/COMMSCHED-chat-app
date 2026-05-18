function doGet() {
  return HtmlService
    .createHtmlOutputFromFile('Index')
    .setTitle('COMMSCHED Chat App');
}