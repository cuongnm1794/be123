(async () => {
  const doctype = document.doctype
    ? `<!DOCTYPE ${document.doctype.name}${document.doctype.publicId ? ` PUBLIC "${document.doctype.publicId}"` : ""}${document.doctype.systemId ? ` "${document.doctype.systemId}"` : ""}>`
    : "<!DOCTYPE html>";

  const html = `${doctype}\n${document.documentElement.outerHTML}`;

  const scripts = [];
  document.querySelectorAll("script").forEach((node, index) => {
    scripts.push({
      index,
      src: node.src || null,
      type: node.type || "text/javascript",
      inline: !node.src,
      content: node.src ? null : node.textContent || "",
    });
  });

  const styles = [];
  document.querySelectorAll("style").forEach((node, index) => {
    styles.push({
      index,
      content: node.textContent || "",
    });
  });

  return {
    html,
    scripts,
    styles,
    title: document.title || "untitled",
    url: location.href,
    exportedAt: new Date().toISOString(),
  };
})();
