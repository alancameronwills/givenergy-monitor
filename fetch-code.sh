echo
date
NAME=giv-tcp-node
if test ! -d ~/codebuffer/$NAME ;
then 
	mkdir ~/codebuffer
	cd ~/codebuffer
	git clone https://github.com/alancameronwills/$NAME.git
fi

cd ~/codebuffer/$NAME
git fetch -q --all &&
git reset --hard origin/master  &&
cp -ruv ~/codebuffer/$NAME ~/$NAME &&
echo "Got code"