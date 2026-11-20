function patch(node, polarity) {
  var data = node.data || {}

  data.polarity = polarity || 0
  data.valence = classify(polarity)

  node.data = data
}