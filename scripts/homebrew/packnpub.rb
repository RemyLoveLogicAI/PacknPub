class Packnpub < Formula
  desc "Add a production-grade release pipeline (npm, GitHub Releases, GitHub Packages, Homebrew) to any Node package with one command"
  homepage "https://github.com/RemyLoveLogicAI/PacknPub"
  url "https://registry.npmjs.org/packnpub/-/packnpub-0.1.0.tgz"
  sha256 "0000000000000000000000000000000000000000000000000000000000000000"
  license "MIT"

  depends_on "node"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/packnpub --version")
  end
end
