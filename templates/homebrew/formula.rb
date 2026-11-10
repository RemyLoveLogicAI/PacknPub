class {{FORMULA_CLASS}} < Formula
  desc "{{DESCRIPTION}}"
  homepage "https://github.com/{{OWNER}}/{{REPO}}"
  url "https://registry.npmjs.org/{{PKG}}/-/{{UNSCOPED}}-{{VERSION}}.tgz"
  sha256 "0000000000000000000000000000000000000000000000000000000000000000"
  license "{{LICENSE}}"

  depends_on "node"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/{{BIN}} --version")
  end
end
