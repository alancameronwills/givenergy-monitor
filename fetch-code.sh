echo
date
NAME=givenergy-monitor
if test ! -d ~/codebuffer/$NAME ;
then 
	mkdir ~/codebuffer
	cd ~/codebuffer
	git clone https://github.com/alancameronwills/$NAME.git
fi

cd ~/codebuffer/$NAME
git fetch -q --all &&
git reset --hard origin/main  &&
cp -ruv ~/codebuffer/$NAME ~/ &&
echo "Got code"