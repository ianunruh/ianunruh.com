TARGET_SERVER = "seahawk.ianunruh.com"
TARGET_PATH = "~/public_html"
OUTPUT_PATH = "_site"

task :deploy do
  puts "+ Building site with Jekyll"
  system "jekyll build"

  puts "+ Copying compiled site to production"
  system "rsync -av --progress #{OUTPUT_PATH}/* #{TARGET_SERVER}:#{TARGET_PATH}"
end
